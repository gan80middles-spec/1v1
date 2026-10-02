import type { ContentBundle } from '../contracts/content.js';
import type { Effect } from '../contracts/content-schema.js';
import type { ActionIntent, Vec2 } from '../contracts/state.js';
import type { ActionReceipt, BattleEvent, CastRuntime, EventPayloads, FighterConfig, FighterEntity, FighterStep, FighterWorld, HitSpec, ReceiptReason, WorldView, FighterEngineBuild } from '../contracts/fighter.js';
import { ActionIntentSchema } from '../contracts/fighter-schema.js';
import { deepFreeze } from '../math/canonical.js';
import { hashCanonical } from '../math/hash.js';
import { limitVelocity, lerpPosition, sweepCircles } from '../math/geometry.js';
import { initialFighterState, validateFighterSnapshot } from './fighter-state.js';
import { applyBodyAttributes, castRejection, effective, phaseAt } from './abilities/effective.js';
import { moveBodies, type Segment } from './physics/motion.js';
import { speedImpactDamage } from '../math/ability-effects.js';
import { projectileSubstep } from './abilities/projectile.js';
import { rulesetFor } from './rulesets.js';
interface Candidate {
    sourceId: number;
    targetId: number;
    castId: number;
    hit: HitSpec;
    projectileId: number | null;
    position: Vec2;
    cause?: Pick<BattleEvent,'seq'|'rootEventId'|'depth'>;
}
export class FighterSimulation {
    private world: WorldView;
    constructor(readonly content: ContentBundle, config: FighterConfig, initial?: unknown, readonly engineBuild:FighterEngineBuild='phase1-v1') {
        this.world = initial ? validateFighterSnapshot(initial, content,engineBuild) : initialFighterState(config, content,engineBuild);
        if (hashCanonical(this.world.config) !== hashCanonical(config))
            throw new Error('Initial config mismatch');
    }
    snapshot(): WorldView { return this.world; }
    restore(input: unknown): void {
        const w = validateFighterSnapshot(input, this.content,this.engineBuild);
        if (hashCanonical(w.config) !== hashCanonical(this.world.config))
            throw new Error('Restore config mismatch');
        this.world = w;
    }
    step(inputs: readonly [
        ActionIntent,
        ActionIntent
    ]): FighterStep {
        if (this.world.result)
            throw new Error('Match already ended');
        const w = JSON.parse(JSON.stringify(this.world)) as FighterWorld, t = w.tick, events: BattleEvent[] = [], receipts: ActionReceipt[] = [];
        const cause = (castId: number): Pick<BattleEvent, 'seq' | 'rootEventId' | 'depth'> | null => { const c = w.casts.find(c => c.castId === castId); return c ? { seq: c.rootEventSeq, rootEventId: c.rootEventSeq, depth: 0 } : null; };
        const emit = <K extends keyof EventPayloads>(type: K, payload: EventPayloads[K], sourceId: number | null = null, targetId: number | null = null, position: Vec2 | null = null, parent: Pick<BattleEvent, 'seq' | 'rootEventId' | 'depth'> | null = null): BattleEvent => {
            if (events.length >= 256 || (parent?.depth ?? -1) >= 4)
                throw new Error('effect/causal budget exceeded');
            const seq = w.nextEventSeq++;
            const e = { seq, tick: t, type, payload, sourceId, targetId, position: position ? { ...position } : null, rootEventId: parent?.rootEventId ?? seq, parentEventId: parent?.seq ?? null, depth: parent ? parent.depth + 1 : 0 } as BattleEvent;
            events.push(e);
            return e;
        };
        const receipt = (e: FighterEntity, requestId: number, result: ActionReceipt['result'], reason: ReceiptReason = 'ok'): void => { receipts.push({ receiptSeq: w.nextReceiptSeq++, entityId: e.id, requestId, tick: t, result, reason }); };
        const arena = this.content.source.arenas.find(a => a.id === w.config.arenaId)!;
        const interrupt = (e: FighterEntity, reason: 'hitstun' | 'dead'): void => {
            if (e.action.kind !== 'cast')
                return;
            const c = w.casts.find(c => c.castId === (e.action.kind === 'cast' ? e.action.castId : 0))!;
            c.interruptedTick = t;
            receipt(e, c.requestId, 'interrupted');
            emit('CastInterrupted', { castId: c.castId, reason }, e.id, null, null, cause(c.castId));
            w.hitboxes = w.hitboxes.filter(h => h.castId !== c.castId);
            if (c.scheduledPolicy === 'cancel-on-interrupt' || c.firstEmissionTick === null)
                w.scheduledEffects = w.scheduledEffects.filter(s => s.castId !== c.castId);
        };
        try {
            const intents = inputs.map(i => ActionIntentSchema.parse(i)) as [
                ActionIntent,
                ActionIntent
            ];
            if (t === 0)
                emit('MatchStarted', { matchId: w.config.matchId });
            for (const e of w.entities) {
                const expired = e.statuses.filter(s => s.expiresTick <= t);
                e.statuses = e.statuses.filter(s => s.expiresTick > t);
                for (const s of expired)
                    emit('StatusExpired', { statusId: s.definitionId }, e.id);
                if (e.action.kind === 'hitstun' && t >= e.action.untilTick)
                    e.action = { kind: 'free' };
                if (e.action.kind === 'cast' && phaseAt(e, t) === 'free') {
                    const c = w.casts.find(c => c.castId === (e.action.kind === 'cast' ? e.action.castId : 0))!;
                    c.finishedTick = t;
                    receipt(e, c.requestId, 'finished');
                    emit('CastFinished', { castId: c.castId }, e.id);
                    e.action = { kind: 'free' };
                }
                applyBodyAttributes(e, this.content, t, arena);
            }
            for (const r of w.passiveRuntime)
                if (t >= r.expiresTick)
                    r.stacks = 0;
            w.hitboxes = w.hitboxes.filter(h => h.expiresTick > t);
            for (const p of w.projectiles.filter(p => p.expiresTick <= t))
                emit('ProjectileExpired', { projectileId: p.id, reason: 'lifetime' }, p.ownerId);
            w.projectiles = w.projectiles.filter(p => p.expiresTick > t);
            for (let i = 0; i < 2; i++) {
                const e = w.entities[i]!, intent = intents[i]!;
                if (intent.moveX !== 0 && (this.engineBuild==='phase1-v1'?phaseAt(e,t)!=='hitstun':phaseAt(e,t)==='free') && e.hp > 0)
                    e.body.facing = intent.moveX;
                if (intent.requestId === null)
                    continue;
                const id = intent.requestId;
                const reject = (reason: ReceiptReason): void => { receipt(e, id, 'rejected', reason); emit('ActionRejected', { requestId: id, reason }, e.id); };
                if (id <= e.lastProcessedRequestId) {
                    reject('duplicate');
                    continue;
                }
                e.lastProcessedRequestId = id;
                if (intent.cast) {
                    const reason = castRejection(e, intent.cast.slot, this.content, t);
                    if (reason) {
                        reject(reason);
                        continue;
                    }
                    const char = this.content.source.characters.find(c => c.id === e.characterId)!, a = this.content.source.abilities.find(a => a.id === char.slots[intent.cast!.slot])!, castId = w.nextCastId++;
                    const c: CastRuntime = { castId, rootEventSeq: w.nextEventSeq, ownerId: e.id, requestId: id, abilityId: a.id, aimX: intent.cast.aimX, startedTick: t, endsTick: t + a.startupTicks + a.activeTicks + a.recoveryTicks, firstEmissionTick: null, interruptedTick: null, finishedTick: null, scheduledPolicy: a.scheduledPolicy ?? 'cancel-on-interrupt' };
                    w.casts.push(c);
                    e.action = { kind: 'cast', castId, requestId: id, abilityId: a.id, startedTick: t, startupTicks: a.startupTicks, activeTicks: a.activeTicks, recoveryTicks: a.recoveryTicks };
                    e.body.facing = intent.cast.aimX;
                    e.cooldownReadyTick[intent.cast.slot] = t + a.cooldownTicks;
                    e.energy -= a.energyCost;
                    if (a.energyCost === 100)
                        e.energySuppressedUntilTick = t + 240;
                    receipt(e, id, 'accepted');
                    emit('CastAccepted', { requestId: id, castId, abilityId: a.id, slot: intent.cast.slot }, e.id);
                    for (const entry of a.timeline)
                        w.scheduledEffects.push({ id: w.nextScheduleId++, dueTick: t + entry.offsetTick, ownerId: e.id, castId, effects: JSON.parse(JSON.stringify(entry.effects)) as Effect[] });
                    if (intent.jumpPressed)
                        reject('conflict');
                }
                else if (intent.jumpPressed) {
                    const phase = phaseAt(e, t);
                    if (phase !== 'free' || !e.body.grounded || e.hp <= 0 || !rulesetFor(w.config.rulesetId).capabilities().jump) {
                        reject(e.hp <= 0 ? 'dead' : phase === 'hitstun' ? 'hitstun' : phase !== 'free' ? 'busy' : 'air-ground');
                        continue;
                    }
                    e.body.velocity.y = effective(e, this.content, t).jumpSpeed;
                    e.body.grounded = false;
                    receipt(e, id, 'accepted');
                    emit('Jumped', { requestId: id }, e.id, null, e.body.position);
                    receipt(e, id, 'finished');
                }
            }
            const due = w.scheduledEffects.filter(s => s.dueTick <= t).sort((a, b) => a.dueTick - b.dueTick || a.id - b.id);
            w.scheduledEffects = w.scheduledEffects.filter(s => s.dueTick > t);
            let effectCount = 0;
            for (const entry of due) {
                const c = w.casts.find(c => c.castId === entry.castId)!, e = w.entities.find(e => e.id === entry.ownerId)!;
                for (const fx of entry.effects) {
                    if (++effectCount > 256)
                        throw new Error('effect budget exceeded');
                    if (fx.kind === 'hitbox') {
                        if (e.hp <= 0 || c.interruptedTick !== null)
                            continue;
                        c.firstEmissionTick ??= t;
                        w.hitboxes.push({ id: w.nextEntityId++, ownerId: e.id, castId: c.castId, localOffset: { ...fx.offset }, baseRadius: fx.radius, radius: fx.radius * effective(e, this.content, t).meleeScale, expiresTick: t + fx.durationTicks, aimX: c.aimX, hit: JSON.parse(JSON.stringify(fx.hit)) as HitSpec });
                    }
                    else if (fx.kind === 'projectile') {
                        c.firstEmissionTick ??= t;
                        const p = { id: w.nextEntityId++, ownerId: e.id, sourceCastId: c.castId, abilityId: c.abilityId, position: { x: e.body.position.x + 48 * c.aimX, y: e.body.position.y + 8 }, velocity: { x: fx.speed * c.aimX, y: 0 }, radius: fx.radius, expiresTick: t + fx.lifetimeTicks, reflectionCount: 0, ignoreOwnerUntilOutside: false, hit: JSON.parse(JSON.stringify(fx.hit)) as HitSpec };
                        w.projectiles.push(p);
                        emit('ProjectileSpawned', { projectileId: p.id, castId: c.castId }, e.id, null, p.position);
                    }
                    else if (fx.kind === 'impulse') {
                        if (fx.target !== 'self')
                            throw new Error('Unsupported target');
                        if (fx.velocityMode === 'set-x')
                            e.body.velocity.x = fx.deltaV.x * c.aimX;
                        else
                            e.body.velocity.x += fx.deltaV.x * c.aimX;
                        e.body.velocity.y += fx.deltaV.y;
                        limitVelocity(e.body.velocity);
                    }
                    else if (fx.kind === 'heal') {
                        e.hp = Math.min(e.maxHp, e.hp + fx.amount);
                    }
                    else if (fx.kind === 'status') {
                        const def = this.content.source.statuses.find(s => s.id === fx.statusId)!, old = e.statuses.find(s => s.definitionId === def.id);
                        if (old && def.stacking !== 'replace') {
                            old.expiresTick = t + def.durationTicks;
                            if((this.engineBuild==='phase3a-v1'||this.engineBuild==='phase3b-v1')){old.sourceCastId=c.castId;old.appliedTick=t;}
                            if (def.stacking === 'stack')
                                old.stacks = Math.min(def.maxStacks, old.stacks + 1);
                            emit('StatusApplied', { statusId: def.id, expiresTick: old.expiresTick, stacks: old.stacks, castId: c.castId }, e.id);
                        }
                        else {
                            e.statuses = e.statuses.filter(s => s.definitionId !== def.id);
                            e.statuses.push({ instanceId: w.nextStatusId++, definitionId: def.id, sourceId: e.id, sourceCastId: c.castId, appliedTick: t, expiresTick: t + def.durationTicks, stacks: 1 });
                            emit('StatusApplied', { statusId: def.id, expiresTick: t + def.durationTicks, stacks: 1, castId: c.castId }, e.id);
                        }
                        applyBodyAttributes(e, this.content, t, arena);
                    }
                    else
                        throw new Error('Unsupported effect plugin');
                }
            }
            if (w.projectiles.length > 32 || w.entities.length + w.projectiles.length + w.hitboxes.length > 64 || w.scheduledEffects.length > 256)
                throw new Error('entity/scheduler budget exceeded');
            const candidates: Candidate[] = [];
            const registered = (castId: number, group: string, targetId: number): boolean => w.hitRegistry.some(r => r.castId === castId && r.hitGroup === group && r.targetId === targetId);
            const add = (candidate: Candidate): void => {
                if (registered(candidate.castId, candidate.hit.hitGroup, candidate.targetId))
                    return;
                w.hitRegistry.push({ castId: candidate.castId, hitGroup: candidate.hit.hitGroup, targetId: candidate.targetId, lastHitTick: t });
                candidates.push(candidate);
            };
            const interpolate = (s: Segment, time: number): Vec2 => lerpPosition(s.from, s.to, (time - s.start) / (s.end - s.start || 1));
            for (let sub = 0; sub < 4; sub++) {
                const mats = w.entities.map(e => effective(e, this.content, t)) as [
                    ReturnType<typeof effective>,
                    ReturnType<typeof effective>
                ];
                const moves = w.entities.map((e, i) => {
                    const phase = phaseAt(e, t);
                    if (phase === 'hitstun' || phase === 'dead')
                        return null;
                    if (e.action.kind === 'cast') {
                        const ability = this.content.source.abilities.find(a => a.id === (e.action.kind === 'cast' ? e.action.abilityId : ''))!;
                        if (ability.movementScale === 0 || (ability.tags.includes('mobility') && phase === 'active'))
                            return null;
                        mats[i]!.moveSpeed *= ability.movementScale;
                    }
                    return intents[i]!.moveX;
                });
                const paths = moveBodies(w.entities, mats, moves, arena, 1 / 240, b => {
                    const bounce = emit('WallBounce', { wall: b.wall, incomingNormalSpeed: b.incomingSpeed, castId: b.entity.lastLaunchCastId }, b.entity.id, null, b.position);
                    const r = w.passiveRuntime.find(r => r.entityId === b.entity.id);
                    if (!r)
                        return;
                    const plugin = this.content.source.passives.find(p => p.id === r.passiveId)!.effects[0]!;
                    if (plugin.kind !== 'plugin')
                        throw new Error('Invalid passive plugin');
                    const params = plugin.params;
                    if (b.wall === 'floor' || b.incomingSpeed < Number(params['minIncomingSpeed']) || t < r.nextAllowedTick || b.entity.hp <= 0)
                        return;
                    r.stacks = Math.min(Number(params['maxStacks']), r.stacks + 1);
                    r.expiresTick = t + Number(params['durationTicks']);
                    r.nextAllowedTick = t + Number(params['internalCooldownTicks']);
                    const growth = effective(b.entity, this.content, t).wallGrowth;
                    b.entity.body.velocity.x *= 1 + growth * r.stacks;
                    b.entity.body.velocity.y *= 1 + growth * r.stacks;
                    limitVelocity(b.entity.body.velocity);
                    emit('PassiveTriggered', { passiveId: r.passiveId, stacks: r.stacks, expiresTick: r.expiresTick }, b.entity.id, null, b.position, bounce);
                }, (code, detail) => { if (w.diagnostics.length >= 64)
                    throw new Error('diagnostic budget exceeded'); w.diagnostics.push({ tick: t, code, detail }); emit('Diagnostic', { code, detail }); },this.engineBuild!=='phase1-v1');
                for (const h of w.hitboxes) {
                    const ownerIndex = w.entities.findIndex(e => e.id === h.ownerId), targetIndex = 1 - ownerIndex, owner = w.entities[ownerIndex]!, target = w.entities[targetIndex]!;
                    h.radius = h.baseRadius * effective(owner, this.content, t).meleeScale;
                    for (const a of paths[ownerIndex]!)
                        for (const b of paths[targetIndex]!) {
                            const start = Math.max(a.start, b.start), end = Math.min(a.end, b.end);
                            if (end < start)
                                continue;
                            const offset = (p: Vec2): Vec2 => ({ x: p.x + h.localOffset.x * h.aimX, y: p.y + h.localOffset.y });
                            if (sweepCircles(offset(interpolate(a, start)), offset(interpolate(a, end)), h.radius, interpolate(b, start), interpolate(b, end), target.body.radius) !== null) {
                                const velocity=(s:Segment)=>({x:(s.to.x-s.from.x)*240/(s.end-s.start||1),y:(s.to.y-s.from.y)*240/(s.end-s.start||1)}),va=velocity(a),vb=velocity(b);
                                const runtime=w.casts.find(c=>c.castId===h.castId)!;
                                const damage=(this.engineBuild==='phase3a-v1'||this.engineBuild==='phase3b-v1')?speedImpactDamage(this.content,owner.characterId,runtime.abilityId,h.hit.damage,Math.hypot(va.x-vb.x,va.y-vb.y)):h.hit.damage;
                                add({ sourceId: h.ownerId, targetId: target.id, castId: h.castId, hit: { ...h.hit,damage, launchDeltaV: { x: h.hit.launchDeltaV.x * h.aimX, y: h.hit.launchDeltaV.y } }, projectileId: null, position: { ...target.body.position } });
                            }
                        }
                }
                const removed = new Set<number>();
                for (const p of w.projectiles) {
                    if((this.engineBuild==='phase3a-v1'||this.engineBuild==='phase3b-v1')){
                        const contact=projectileSubstep(p,w.entities,paths,this.content,t,arena);
                        if(contact.kind==='reflect'){
                            const reflected=emit('ProjectileReflected',{projectileId:p.id,castId:p.sourceCastId,defenseCastId:contact.defenseCastId,previousOwnerId:contact.previousOwnerId,reflectionCount:p.reflectionCount,velocity:{...p.velocity},preventedDamage:p.hit.damage},contact.target.id,contact.previousOwnerId,contact.position,p.reflectionCause??cause(p.sourceCastId));
                            p.reflectionCause={seq:reflected.seq,rootEventId:reflected.rootEventId,depth:reflected.depth};
                        }else if(contact.kind==='dissipate'){
                            removed.add(p.id);emit('ProjectileDissipated',{projectileId:p.id,castId:p.sourceCastId,defenseCastId:contact.defenseCastId,reflectionCount:p.reflectionCount},contact.target.id,contact.previousOwnerId,contact.position,p.reflectionCause??cause(p.sourceCastId));
                        }else if(contact.kind==='hit'){
                            const sign=p.velocity.x<0?-1:1;
                            add({sourceId:p.ownerId,targetId:contact.target.id,castId:p.sourceCastId,hit:{...p.hit,launchDeltaV:{x:p.hit.launchDeltaV.x*sign,y:p.hit.launchDeltaV.y}},projectileId:p.id,position:contact.position,...(p.reflectionCause?{cause:p.reflectionCause}:{})});
                            removed.add(p.id);emit('ProjectileExpired',{projectileId:p.id,reason:'hit'},p.ownerId);
                        }else if(contact.kind==='wall'){removed.add(p.id);emit('ProjectileExpired',{projectileId:p.id,reason:'wall'},p.ownerId);}
                        continue;
                    }
                    const from = { ...p.position }, to = { x: from.x + p.velocity.x / 240, y: from.y + p.velocity.y / 240 };
                    let wallTime = 1;
                    if (to.x < p.radius)
                        wallTime = Math.min(wallTime, (p.radius - from.x) / (to.x - from.x));
                    if (to.x > arena.width - p.radius)
                        wallTime = Math.min(wallTime, (arena.width - p.radius - from.x) / (to.x - from.x));
                    if (to.y < p.radius)
                        wallTime = Math.min(wallTime, (p.radius - from.y) / (to.y - from.y));
                    if (to.y > arena.height - p.radius)
                        wallTime = Math.min(wallTime, (arena.height - p.radius - from.y) / (to.y - from.y));
                    wallTime = Math.max(0, wallTime);
                    let hitTime = Infinity, target: FighterEntity | null = null;
                    for (let i = 0; i < 2; i++) {
                        const e = w.entities[i]!;
                        if (e.id === p.ownerId)
                            continue;
                        for (const s of paths[i]!) {
                            const f = sweepCircles(lerpPosition(from, to, s.start), lerpPosition(from, to, s.end), p.radius, s.from, s.to, e.body.radius);
                            if (f !== null) {
                                const when = s.start + (s.end - s.start) * f;
                                if (when < hitTime) {
                                    hitTime = when;
                                    target = e;
                                }
                            }
                        }
                    }
                    if (target && hitTime <= wallTime) {
                        const sign = p.velocity.x < 0 ? -1 : 1;
                        add({ sourceId: p.ownerId, targetId: target.id, castId: p.sourceCastId, hit: { ...p.hit, launchDeltaV: { x: p.hit.launchDeltaV.x * sign, y: p.hit.launchDeltaV.y } }, projectileId: p.id, position: lerpPosition(from, to, hitTime) });
                        removed.add(p.id);
                        emit('ProjectileExpired', { projectileId: p.id, reason: 'hit' }, p.ownerId);
                    }
                    else if (wallTime < 1 || to.x <= p.radius || to.x >= arena.width - p.radius || to.y <= p.radius || to.y >= arena.height - p.radius) {
                        removed.add(p.id);
                        emit('ProjectileExpired', { projectileId: p.id, reason: 'wall' }, p.ownerId);
                    }
                    else
                        p.position = to;
                }
                w.projectiles = w.projectiles.filter(p => !removed.has(p.id));
            }
            candidates.sort((a, b) => a.targetId - b.targetId || a.castId - b.castId || (a.hit.hitGroup < b.hit.hitGroup ? -1 : a.hit.hitGroup > b.hit.hitGroup ? 1 : 0));
            const energy = [0, 0];
            for (const e of w.entities) {
                const hits = candidates.filter(c => c.targetId === e.id);
                if (!hits.length)
                    continue;
                const material = effective(e, this.content, t);
                let remaining = e.hp, launchX = 0, launchY = 0, stun = 0, lastCast: number | null = null;
                for (const hit of hits) {
                    const parent = emit('HitResolved', { castId: hit.castId, hitGroup: hit.hit.hitGroup, projectileId: hit.projectileId }, hit.sourceId, e.id, hit.position, hit.cause??cause(hit.castId));
                    const nominal = hit.hit.damage * material.damageTaken, amount = Math.min(remaining, nominal), before = remaining;
                    remaining -= amount;
                    emit('DamageResolved', { castId: hit.castId, amount, hpBefore: before, hpAfter: remaining }, hit.sourceId, e.id, hit.position, parent);
                    if (nominal < hit.hit.damage)
                        emit('DamagePrevented', { castId: this.engineBuild==='phase1-v1'?hit.castId:(e.statuses.find(s=>this.content.source.statuses.find(d=>d.id===s.definitionId)!.modifiers.damageTakenMultiplier<1)?.sourceCastId??hit.castId), preventedDamage: hit.hit.damage - nominal }, e.id, hit.sourceId, hit.position, parent);
                    energy[e.id - 1]! += amount * .55;
                    energy[hit.sourceId - 1]! += amount * .35;
                    launchX += hit.hit.launchDeltaV.x / e.body.mass * material.knockbackTaken;
                    launchY += hit.hit.launchDeltaV.y / e.body.mass * material.knockbackTaken;
                    stun = Math.max(stun, hit.hit.hitstunTicks);
                    lastCast = hit.castId;
                }
                e.hp = remaining;
                e.body.velocity.x = e.body.velocity.x * .25 + launchX;
                e.body.velocity.y = e.body.velocity.y * .25 + launchY;
                limitVelocity(e.body.velocity);
                e.body.grounded = false;
                e.lastLaunchCastId = lastCast;
                e.lastLaunchTick = t;
                if (e.hp <= 0) {
                    interrupt(e, 'dead');
                    e.action = { kind: 'dead' };
                    emit('EntityDied', { lastDamageCastId: lastCast }, e.id, null, e.body.position);
                }
                else if (stun > 0) {
                    interrupt(e, 'hitstun');
                    const previous = e.action.kind === 'hitstun' ? e.action.untilTick : 0;
                    e.action = { kind: 'hitstun', untilTick: Math.max(previous, t + 1 + stun) };
                }
            }
            for (const e of w.entities)
                if (e.hp > 0 && t >= e.energySuppressedUntilTick)
                    e.energy = Math.min(100, e.energy + 1 / 60 + Math.min(12, energy[e.id - 1]!));
            // Registries live as long as their cast, including surviving scheduled emissions/projectiles.
            const live = new Set(w.entities.flatMap(e => e.action.kind === 'cast' ? [e.action.castId] : []));
            for (const p of w.projectiles)
                live.add(p.sourceCastId);
            for (const h of w.hitboxes)
                live.add(h.castId);
            for (const s of w.scheduledEffects)
                live.add(s.castId);
            w.casts = w.casts.filter(c => live.has(c.castId));
            w.hitRegistry = w.hitRegistry.filter(r => live.has(r.castId));
            w.tick = t + 1;
            w.result=rulesetFor(w.config.rulesetId).evaluateResult(w);
            if(w.result)emit('MatchEnded',{result:w.result});
            this.world = deepFreeze(w);
        }
        catch (error) {
            const safe = JSON.parse(JSON.stringify(this.world)) as FighterWorld;
            safe.tick = t + 1;
            const detail = error instanceof Error ? error.message : String(error), code = 'SIMULATION_INVALID';
            safe.diagnostics.push({ tick: t, code, detail });
            safe.result = { matchId: safe.config.matchId, reason: 'invalid', winnerParticipantId: null, endedAfterTicks: safe.tick, remainingHp: [safe.entities[0].hp, safe.entities[1].hp], diagnosticCode: code };
            events.length = 0;
            receipts.length = 0;
            safe.nextEventSeq = this.world.nextEventSeq;
            w.nextEventSeq = safe.nextEventSeq;
            emit('Diagnostic', { code, detail });
            emit('MatchEnded', { result: safe.result });
            safe.nextEventSeq = w.nextEventSeq;
            this.world = deepFreeze(safe);
        }
        return deepFreeze({ state: this.world, events, receipts });
    }
}
