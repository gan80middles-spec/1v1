import type { ContentBundle, DeepReadonly } from '../contracts/content.js';
import type { AIProfile, AbilityDefinition, Effect } from '../contracts/content-schema.js';
import type { Observation, PublicProjectile } from '../contracts/fighter.js';
import type { AIMemory, Belief, ExecutionMemory, MotionParams, MotionState, Option, OutcomeEstimate, ThreatWindow, UtilitySettings } from '../contracts/ai.js';
import type { Vec2 } from '../contracts/state.js';
import { sweepCircles, lerpPosition, limitVelocity } from '../math/geometry.js';
import { actionPhase } from '../math/fighter-phase.js';
import { abilityFor, attributes, clamp01, direction, distanceBand, positionQuality } from './abilities.js';
import { contextAt, possibleBasicLikelihood } from './memory.js';
import { advanceMotion, resolvePredictedContact } from './motion.js';
export interface PredictionContext {
    observation: Observation;
    content: ContentBundle;
    profile: AIProfile;
    belief: Belief;
    memory: AIMemory;
    execution: ExecutionMemory;
    settings: UtilitySettings;
}
type AttackEffect = DeepReadonly<Extract<Effect, {
    kind: 'hitbox' | 'projectile';
}>>;
export interface ThreatModel extends ThreatWindow {
    effect: AttackEffect;
    aimX: -1 | 1;
    birth: number;
    publicProjectile: PublicProjectile | null;
}
interface Point {
    tick: number;
    body: MotionState;
}
interface Branch {
    damage: number;
    meanLoss: number;
    rawLoss: number;
    kill: number;
    death: number;
    earlyRisk: number;
    quality: number;
    progress: number;
    residual: number;
    hitTicks: number[];
    setup: number;
    setupReason: string;
}
export const PREDICTION_HORIZON = 30;
const cloneMotion = (body: MotionState): MotionState => ({ ...body, position: { ...body.position }, velocity: { ...body.velocity } });
const bodyOf = (o: Observation): MotionState => ({ ...o.self.entity.body, position: { ...o.self.entity.body.position }, velocity: { ...o.self.entity.body.velocity } });
export function buildThreats(c: PredictionContext): ThreatModel[] {
    const { observation: o, content, belief, memory, settings } = c, enemy = belief.opponent;
    if (!enemy)
        return [];
    const threats: ThreatModel[] = [];
    for (const p of o.projectiles.filter(p => p.ownerId !== o.self.entity.id)) {
        const a = content.source.abilities.find(a => a.id === p.abilityId)!, fx = a.timeline.flatMap(t => t.effects).find(f => f.kind === 'projectile') as AttackEffect | undefined;
        if (!fx)
            continue;
        threats.push({ id: `projectile:${p.id}`, sourceId: enemy.id, kind: 'committed', origin: 'projectile', abilityId: a.id, startInTicks: 0, endInTicks: 30, estimatedDamage: fx.hit.damage, likelihood: 1, reflectable: p.reflectable, projectileId: p.id, effect: fx, aimX: direction(p.velocity.x, enemy.facing), birth: 0, publicProjectile: p });
    }
    let busyUntil = 0;
    if (enemy.tell) {
        const a = content.source.abilities.find(a => a.id === enemy.tell!.abilityId)!, start = enemy.tell.visibleSinceTick - o.nowTick;
        busyUntil = Math.max(0, start + a.startupTicks + a.activeTicks + a.recoveryTicks);
        for (let i = 0; i < a.timeline.length; i++) {
            const entry = a.timeline[i]!;
            for (const fx of entry.effects) {
                if (fx.kind !== 'hitbox' && fx.kind !== 'projectile')
                    continue;
                const born = start + entry.offsetTick, end = born + (fx.kind === 'hitbox' ? fx.durationTicks : fx.lifetimeTicks);
                if (end <= 0 || born > 60)
                    continue;
                if (fx.kind === 'projectile' && a.timeline[i]!.offsetTick <= (o.sensedTick ?? o.nowTick) - enemy.tell.visibleSinceTick)
                    continue;
                threats.push({ id: `cast:${a.id}:${enemy.tell.visibleSinceTick}:${i}:${fx.hit.hitGroup}`, sourceId: enemy.id, kind: 'committed', origin: 'cast', abilityId: a.id, startInTicks: Math.max(0, born), endInTicks: Math.min(60, end), estimatedDamage: fx.hit.damage, likelihood: 1, reflectable: fx.kind === 'projectile' && fx.reflectable, projectileId: null, effect: fx, aimX: enemy.facing, birth: born, publicProjectile: null });
            }
        }
    }
    const basic = abilityFor(content, enemy.characterId, 'basic'), known = memory.opponentCooldownEstimates.find(e => e.abilityId === basic.id), ready = Math.max(busyUntil, known ? known.earliestReadyTick - o.nowTick : 0), likelihood = possibleBasicLikelihood(memory, contextAt(o), settings.memory);
    for (const entry of basic.timeline)
        for (const fx of entry.effects)
            if ((fx.kind === 'hitbox' || fx.kind === 'projectile') && ready + entry.offsetTick <= 60) {
                const born = Math.max(0, ready) + entry.offsetTick;
                threats.push({ id: `possible-basic:${fx.hit.hitGroup}`, sourceId: enemy.id, kind: 'possible-basic', origin: 'possible', abilityId: basic.id, startInTicks: born, endInTicks: born + (fx.kind === 'hitbox' ? fx.durationTicks : fx.lifetimeTicks), estimatedDamage: fx.hit.damage, likelihood, reflectable: fx.kind === 'projectile' && fx.reflectable, projectileId: null, effect: fx, aimX: direction(o.self.entity.body.position.x - enemy.position.x, enemy.facing), birth: born, publicProjectile: null });
            }
    if (threats.length > 64)
        throw new Error('AI threat budget exceeded');
    return threats;
}
export function describeThreats(models: readonly ThreatModel[]): ThreatWindow[] { return models.map(m => ({ id: m.id, sourceId: m.sourceId, kind: m.kind, origin: m.origin, abilityId: m.abilityId, startInTicks: m.startInTicks, endInTicks: m.endInTicks, estimatedDamage: m.estimatedDamage, likelihood: m.likelihood, reflectable: m.reflectable, projectileId: m.projectileId })); }
function selfCast(c: PredictionContext, option: Option): {
    ability: DeepReadonly<AbilityDefinition>;
    start: number;
    aimX: -1 | 1;
} | null {
    const o = c.observation;
    if (option.kind === 'cast')
        return { ability: abilityFor(c.content, o.self.entity.characterId, option.slot!), start: 0, aimX: option.aimX };
    if (o.self.entity.action.kind === 'cast' && actionPhase(o.self.entity, o.nowTick) !== 'free')
        return { ability: c.content.source.abilities.find(a => a.id === (o.self.entity.action.kind === 'cast' ? o.self.entity.action.abilityId : ''))!, start: o.self.entity.action.startedTick - o.nowTick, aimX: c.execution.activeSlot !== null ? c.execution.activeAimX : o.self.entity.body.facing };
    return null;
}
function landingIn(body: MotionState, gravity: number): number | null { if (body.grounded || gravity >= 0)
    return null; const v = body.velocity.y, dy = body.position.y - body.radius, root = (-v - Math.sqrt(Math.max(0, v * v - 2 * gravity * dy))) / gravity * 60; return root > 0 && root < 30 ? root : null; }
export function predictionGrid(c: PredictionContext, option: Option, models: readonly ThreatModel[]): {
    ticks: number[];
    budgetExceeded: boolean;
} {
    const important = new Set([0, 30]), cast = selfCast(c, option);
    const add = (n: number): void => { if (n > 0 && n < 30)
        important.add(n); };
    if (cast) {
        add(cast.start + cast.ability.startupTicks);
        add(cast.start + cast.ability.startupTicks + cast.ability.activeTicks);
        add(cast.start + cast.ability.startupTicks + cast.ability.activeTicks + cast.ability.recoveryTicks);
        for (const e of cast.ability.timeline) {
            add(cast.start + e.offsetTick);
            for (const f of e.effects)
                if (f.kind === 'hitbox')
                    add(cast.start + e.offsetTick + f.durationTicks);
        }
    }
    for (const m of models) {
        add(m.startInTicks);
        add(m.endInTicks);
    }
    const own = bodyOf(c.observation);
    if (option.kind === 'jump') {
        own.grounded = false;
        own.velocity.y = attributes(c.content, c.observation.self.entity, c.observation.nowTick).jumpSpeed;
    }
    add(landingIn(own, c.observation.arena.gravity.y) ?? 0);
    const enemy = c.belief.opponent;
    if (enemy)
        add(landingIn({ ...enemy, mass: 1 }, c.observation.arena.gravity.y) ?? 0);
    const exceeded = important.size > 13;
    let ticks = [...important].sort((a, b) => a - b);
    if (exceeded)
        ticks = [...ticks.slice(0, 12), 30];
    else
        for (let t = 6; t < 30; t += 6)
            if (important.size < 13)
                important.add(t);
    if (!exceeded)
        ticks = [...important].sort((a, b) => a - b);
    return { ticks, budgetExceeded: exceeded };
}
function positionAt(points: readonly Point[], tick: number): Vec2 { const a = points.findLast(p => p.tick <= tick) ?? points[0]!, b = points.find(p => p.tick >= tick) ?? points.at(-1)!; return a.tick === b.tick ? { ...a.body.position } : lerpPosition(a.body.position, b.body.position, (tick - a.tick) / (b.tick - a.tick)); }
function ownParams(c: PredictionContext, cast: ReturnType<typeof selfCast>, tick: number): MotionParams {
    const o = c.observation, now = o.nowTick + tick, extra = [];
    if (cast)
        for (const e of cast.ability.timeline)
            if (cast.start + e.offsetTick <= tick)
                for (const fx of e.effects)
                    if (fx.kind === 'status') {
                        const def = c.content.source.statuses.find(s => s.id === fx.statusId)!;
                        if (cast.start + e.offsetTick + def.durationTicks > tick)
                            extra.push({ instanceId: 100000 + extra.length, definitionId: def.id, sourceId: o.self.entity.id, sourceCastId: null, appliedTick: Math.max(0, o.nowTick + cast.start + e.offsetTick), expiresTick: now + 1, stacks: 1 });
                    }
    // Refresh statuses of the same definition, matching the content stacking policy.
    const replaced = new Set(extra.map(e => e.definitionId)), self = { ...o.self.entity, statuses: [...o.self.entity.statuses.filter(s => !replaced.has(s.definitionId)), ...extra] };
    const params = attributes(c.content, self, now);
    if (cast && tick < cast.start + cast.ability.startupTicks + cast.ability.activeTicks + cast.ability.recoveryTicks)
        params.moveSpeed *= cast.ability.movementScale;
    return params;
}
function trajectory(c: PredictionContext, option: Option, grid: readonly number[], hypothesis: Belief['hypotheses'][number]): {
    own: Point[];
    enemy: Point[];
} {
    const o = c.observation, op = c.belief.opponent!, cast = selfCast(c, option), a = bodyOf(o), b: MotionState = { position: { ...op.position }, velocity: { ...op.velocity }, radius: op.radius, mass: c.content.source.characters.find(x => x.id === op.characterId)!.body.mass, grounded: op.grounded, facing: op.facing };
    if (option.kind === 'jump') {
        a.velocity.y = attributes(c.content, o.self.entity, o.nowTick).jumpSpeed;
        a.grounded = false;
    }
    const own: Point[] = [], enemy: Point[] = [], appliedSelf = new Set<number>(), appliedEnemy = new Set<number>();
    let wallStacks = o.self.passives[0]?.stacks ?? 0, nextWall = o.self.passives[0]?.nextAllowedTick ?? 0;
    const enemyCast = op.tell ? c.content.source.abilities.find(x => x.id === op.tell!.abilityId)! : null, enemyStart = op.tell ? op.tell.visibleSinceTick - o.nowTick : 0;
    for (let k = 0; k < grid.length; k++) {
        const t = grid[k]!;
        const impulse = (body: MotionState, ability: DeepReadonly<AbilityDefinition>, start: number, aimX: -1 | 1, done: Set<number>): void => { for (let i = 0; i < ability.timeline.length; i++) {
            const entry = ability.timeline[i]!, due = start + entry.offsetTick;
            if (due < 0 || due > t || done.has(i))
                continue;
            done.add(i);
            for (const fx of entry.effects)
                if (fx.kind === 'impulse') {
                    if (fx.velocityMode === 'set-x')
                        body.velocity.x = fx.deltaV.x * aimX;
                    else
                        body.velocity.x += fx.deltaV.x * aimX;
                    body.velocity.y += fx.deltaV.y;
                    limitVelocity(body.velocity);
                }
        } };
        if (cast)
            impulse(a, cast.ability, cast.start, cast.aimX, appliedSelf);
        if (enemyCast)
            impulse(b, enemyCast, enemyStart, op.facing, appliedEnemy);
        own.push({ tick: t, body: cloneMotion(a) });
        enemy.push({ tick: t, body: cloneMotion(b) });
        if (k === grid.length - 1)
            break;
        const span = grid[k + 1]! - t, fromA = { ...a.position }, fromB = { ...b.position }, pa = ownParams(c, cast, t), pb = attributes(c.content, op, o.nowTick + t);
        let ma: -1 | 0 | 1 | null = option.moveX, mb: -1 | 0 | 1 | null = hypothesis.moveX;
        if (cast && t < cast.start + cast.ability.startupTicks + cast.ability.activeTicks + cast.ability.recoveryTicks && (cast.ability.movementScale === 0 || cast.ability.tags.includes('mobility') && t >= cast.start + cast.ability.startupTicks && t < cast.start + cast.ability.startupTicks + cast.ability.activeTicks))
            ma = null;
        if (enemyCast && t < enemyStart + enemyCast.startupTicks + enemyCast.activeTicks + enemyCast.recoveryTicks) {
            pb.moveSpeed *= enemyCast.movementScale;
            if (enemyCast.movementScale === 0 || enemyCast.tags.includes('mobility') && t >= enemyStart + enemyCast.startupTicks && t < enemyStart + enemyCast.startupTicks + enemyCast.activeTicks)
                mb = null;
        }
        const wall = advanceMotion(a, pa, ma, span, o.arena);
        advanceMotion(b, pb, mb, span, o.arena);
        if (o.self.passives.length && wall.wall && wall.wall !== 'floor' && wall.wallSpeed >= 250 && o.nowTick + t + span >= nextWall) {
            wallStacks = Math.min(3, wallStacks + 1);
            a.velocity.x *= 1 + pa.wallGrowth * wallStacks;
            a.velocity.y *= 1 + pa.wallGrowth * wallStacks;
            limitVelocity(a.velocity);
            nextWall = o.nowTick + t + span + 6;
        }
        resolvePredictedContact(a, b, fromA, fromB, span / 60, Math.min(pa.restitution, pb.restitution));
        for (const body of [a, b]) {
            body.position.x = Math.max(body.radius, Math.min(o.arena.width - body.radius, body.position.x));
            body.position.y = Math.max(body.radius, Math.min(o.arena.height - body.radius, body.position.y));
        }
    }
    return { own, enemy };
}
function hitboxHit(effect: DeepReadonly<Extract<Effect, {
    kind: 'hitbox';
}>>, born: number, owner: readonly Point[], target: readonly Point[], aimX: -1 | 1): number | null {
    const end = born + effect.durationTicks;
    for (let i = 1; i < owner.length; i++) {
        const start = Math.max(owner[i - 1]!.tick, born, 0), stop = Math.min(owner[i]!.tick, end - 1e-7, 30);
        if (stop < start)
            continue;
        const offset = (p: Vec2): Vec2 => ({ x: p.x + effect.offset.x * aimX, y: p.y + effect.offset.y });
        const fraction = sweepCircles(offset(positionAt(owner, start)), offset(positionAt(owner, stop)), effect.radius, positionAt(target, start), positionAt(target, stop), target[i]!.body.radius);
        if (fraction !== null)
            return start + (stop - start) * fraction;
    }
    return null;
}
function projectileHit(effect: DeepReadonly<Extract<Effect, {
    kind: 'projectile';
}>>, born: number, owner: readonly Point[], target: readonly Point[], aimX: -1 | 1, arena: Observation['arena'], initial?: {
    position: Vec2;
    velocity: Vec2;
}): number | null {
    const ownerAt = positionAt(owner, Math.max(0, born)), end = Math.min(30, born + effect.lifetimeTicks), velocity = initial?.velocity ?? { x: effect.speed * aimX, y: 0 };
    const position = initial?.position ?? { x: ownerAt.x + 48 * aimX + (born < 0 ? velocity.x * (-born) / 60 : 0), y: ownerAt.y + 8 };
    const baseTick = initial ? 0 : Math.max(0, born), at = (t: number): Vec2 => ({ x: position.x + velocity.x * (t - baseTick) / 60, y: position.y + velocity.y * (t - baseTick) / 60 });
    const wallTime = velocity.x > 0 ? baseTick + (arena.width - effect.radius - position.x) / velocity.x * 60 : velocity.x < 0 ? baseTick + (effect.radius - position.x) / velocity.x * 60 : Infinity;
    if (position.y < effect.radius || position.y > arena.height - effect.radius || wallTime < baseTick)
        return null;
    for (let i = 1; i < target.length; i++) {
        const start = Math.max(target[i - 1]!.tick, baseTick), stop = Math.min(target[i]!.tick, end, wallTime);
        if (stop < start)
            continue;
        const f = sweepCircles(at(start), at(stop), effect.radius, positionAt(target, start), positionAt(target, stop), target[i]!.body.radius);
        if (f !== null)
            return start + (stop - start) * f;
    }
    return null;
}
function attackHit(fx: AttackEffect, born: number, owner: readonly Point[], target: readonly Point[], aimX: -1 | 1, arena: Observation['arena'], initial?: {
    position: Vec2;
    velocity: Vec2;
}): number | null { return fx.kind === 'hitbox' ? hitboxHit(fx, born, owner, target, aimX) : projectileHit(fx, born, owner, target, aimX, arena, initial); }
function estimatedSetup(c: PredictionContext, option: Option, path: {
    own: Point[];
    enemy: Point[];
}, cast: ReturnType<typeof selfCast>): {
    value: number;
    reason: string;
} {
    if (option.kind !== 'cast' || !cast)
        return { value: 0, reason: 'none' };
    const a = cast.ability, o = c.observation, enemy = c.belief.opponent!;
    if (a.ai.predictorId === 'self-buff') {
        const fx = a.timeline.flatMap(e => e.effects).find(f => f.kind === 'status');
        if (!fx || fx.kind !== 'status')
            return { value: 0, reason: 'no-buff-effect' };
        const def = c.content.source.statuses.find(s => s.id === fx.statusId)!, vx = o.self.entity.body.velocity.x, speed = Math.abs(vx), gap = vx >= 0 ? o.arena.width - o.self.entity.body.radius - o.self.entity.body.position.x : o.self.entity.body.position.x - o.self.entity.body.radius;
        const wallTicks = speed > 0 ? gap / speed * 60 : Infinity, activation = a.timeline.find(e => e.effects.includes(fx))!.offsetTick;
        if (speed < 250 || wallTicks < activation || wallTicks > 90)
            return { value: 0, reason: 'no-reachable-high-speed-wall-opportunity' };
        const stacks = Math.min(3, (o.self.passives[0]?.stacks ?? 0) + 1), base = attributes(c.content, o.self.entity, o.nowTick), boost = def.modifiers.wallGrowthCoefficientOverride ?? base.wallGrowth;
        const wallX = vx > 0 ? o.arena.width - o.self.entity.body.radius : o.self.entity.body.radius, distance = Math.abs(wallX - enemy.position.x), baseSpeed = speed * base.restitution * (1 + base.wallGrowth * stacks), buffSpeed = speed * base.restitution * (1 + boost * stacks), remaining = 120 - wallTicks;
        if (buffSpeed * remaining / 60 + 120 < distance)
            return { value: 0, reason: 'no-reachable-attack-after-wall' };
        const gain = clamp01((buffSpeed - baseSpeed) * remaining / 60 / 120), already = Math.max(0, positionQuality(path.own.at(-1)!.body, path.enemy.at(-1)!.body, o.arena.width, distanceBand(o, c.content, c.profile), true) - positionQuality(path.own[0]!.body, path.enemy[0]!.body, o.arena.width, distanceBand(o, c.content, c.profile), true)) * 3;
        return { value: Math.max(0, Math.min(2, gain * 4 * .6 - already)), reason: `wall opportunity in ${wallTicks.toFixed(1)} ticks; next-attack summary, confidence 0.6` };
    }
    if (a.ai.predictorId === 'volley') {
        let extra = 0;
        const own = path.own.at(-1)!.body, target = path.enemy.at(-1)!.body;
        for (const e of a.timeline)
            for (const fx of e.effects)
                if (fx.kind === 'projectile') {
                    const travel = Math.max(0, Math.abs(target.position.x - (own.position.x + 48 * cast.aimX)) - fx.radius - target.radius) / fx.speed * 60, arrival = e.offsetTick + travel;
                    if (arrival > 30 && arrival <= 60 && Math.abs(target.position.y - (own.position.y + 8)) <= fx.radius + target.radius)
                        extra += fx.hit.damage;
                }
        return { value: Math.min(2, extra * .6 * .25), reason: 'declared volley emissions beyond H, confidence 0.6, capped at 2' };
    }
    return { value: 0, reason: 'none' };
}
export function predictOutcome(c: PredictionContext, option: Option, models = buildThreats(c)): OutcomeEstimate {
    const o = c.observation, enemy = c.belief.opponent;
    const empty: OutcomeEstimate = { expectedDamageDealtPct: 0, meanDamageTakenPct: 0, worstDamageTakenPct: 0, killLikelihood: 0, deathLikelihood: 0, positionQualityBefore: 0, positionQualityAfter: 0, bandProgressPx:0, residualExposurePct: 0, setupValue: 0, confidence: c.belief.confidence, earlyRiskPct: 0, hitTicks: [], segmentsUsed: 0, budgetExceeded: false, setupConfidence: .6, setupReason: 'none' };
    if (!enemy)
        return empty;
    const grid = predictionGrid(c, option, models), cast = selfCast(c, option), branches: Branch[] = [], quiet = o.nowTick - c.memory.lastEffectiveInteractionTick, band = distanceBand(o, c.content, c.profile, quiet, models.some(m => m.kind === 'committed')), enemyMax = c.content.source.characters.find(d => d.id === enemy.characterId)!.stats.maxHp, enemyHp = enemy.hpRatio * enemyMax;
    for (const hypothesis of c.belief.hypotheses) {
        const path = trajectory(c, option, grid.ticks, hypothesis), attacks: {
            tick: number;
            amount: number;
        }[] = [], groups = new Set<string>(), targetMultiplier = attributes(c.content, enemy, o.nowTick).damageTaken;
        if (cast)
            for (const entry of cast.ability.timeline)
                for (const fx of entry.effects)
                    if (fx.kind === 'hitbox' || fx.kind === 'projectile') {
                        if (fx.kind === 'projectile' && cast.start + entry.offsetTick <= -Math.min(18, c.belief.age ?? 0) && option.kind !== 'cast')
                            continue;
                        if (groups.has(fx.hit.hitGroup))
                            continue;
                        const tick = attackHit(fx, cast.start + entry.offsetTick, path.own, path.enemy, cast.aimX, o.arena);
                        if (tick !== null) {
                            groups.add(fx.hit.hitGroup);
                            attacks.push({ tick, amount: fx.hit.damage * targetMultiplier });
                        }
                    }
        for (const p of o.projectiles.filter(p => p.ownerId === o.self.entity.id)) {
            const a = c.content.source.abilities.find(a => a.id === p.abilityId)!, fx = a.timeline.flatMap(t => t.effects).find(f => f.kind === 'projectile');
            if (!fx || fx.kind !== 'projectile')
                continue;
            const age = Math.min(18, c.belief.age ?? 0), tick = projectileHit(fx, 0, path.own, path.enemy, direction(p.velocity.x), o.arena, { position: { x: p.position.x + p.velocity.x * age / 60, y: p.position.y + p.velocity.y * age / 60 }, velocity: p.velocity });
            if (tick !== null)
                attacks.push({ tick, amount: fx.hit.damage * targetMultiplier });
        }
        const hits: {
            tick: number;
            amount: number;
            likelihood: number;
            origin: ThreatModel['origin'];
        }[] = [];
        for (const m of models) {
            let initial: undefined | {
                position: Vec2;
                velocity: Vec2;
            };
            if (m.publicProjectile) {
                const p = m.publicProjectile, age = Math.min(18, c.belief.age ?? 0);
                initial = { position: { x: p.position.x + p.velocity.x * age / 60, y: p.position.y + p.velocity.y * age / 60 }, velocity: p.velocity };
            }
            const tick = attackHit(m.effect, m.birth, path.enemy, path.own, m.aimX, o.arena, initial);
            if (tick !== null) {
                const multiplier = ownParams(c, cast, tick).damageTaken;
                hits.push({ tick, amount: m.estimatedDamage * multiplier, likelihood: m.likelihood, origin: m.origin });
            }
        }
        attacks.sort((a, b) => a.tick - b.tick);
        hits.sort((a, b) => a.tick - b.tick);
        let dealt = 0, killAt = Infinity;
        for (const h of attacks) {
            dealt += h.amount;
            if (dealt >= enemyHp) {
                killAt = h.tick;
                break;
            }
        }
        const effectiveHits = hits.filter(h => h.origin === 'projectile' || h.tick <= killAt), rawLoss = Math.min(o.self.entity.hp, effectiveHits.reduce((sum, h) => sum + h.amount, 0)), meanLoss = Math.min(o.self.entity.hp, effectiveHits.reduce((sum, h) => sum + h.amount * h.likelihood, 0));
        let loss = 0, death = 0, deathAt = Infinity;
        for (const h of effectiveHits) {
            loss += h.amount;
            if (loss >= o.self.entity.hp) {
                death = h.likelihood;
                deathAt = h.tick;
                break;
            }
        }
        const earned = Math.min(enemyHp, attacks.filter(h => h.tick <= deathAt).reduce((sum, h) => sum + h.amount, 0)), earlyRisk = Math.min(o.self.entity.hp, effectiveHits.filter(h => h.tick <= 12).reduce((sum, h) => sum + h.amount * h.likelihood, 0));
        const recoveryEnd = cast ? cast.start + cast.ability.startupTicks + cast.ability.activeTicks + cast.ability.recoveryTicks : 0, extra = Math.max(0, Math.min(30, recoveryEnd - 30)), endOwn = path.own.at(-1)!.body, endEnemy = path.enemy.at(-1)!.body, basic = abilityFor(c.content, enemy.characterId, 'basic'), basicFx = basic.timeline.flatMap(t => t.effects).find(f => f.kind === 'hitbox'), reach = basicFx?.kind === 'hitbox' ? Math.abs(basicFx.offset.x) + basicFx.radius + endOwn.radius : 0, endDistance = Math.hypot(endOwn.position.x - endEnemy.position.x, endOwn.position.y - endEnemy.position.y), known = c.memory.opponentCooldownEstimates.find(m => m.abilityId === basic.id), available = !known || known.earliestReadyTick <= o.nowTick + 30 + extra;
        const residual = extra && available && endDistance <= reach + attributes(c.content, enemy, o.nowTick).moveSpeed * extra / 60 ? Math.min(12, (basicFx?.kind === 'hitbox' ? basicFx.hit.damage : 8) * possibleBasicLikelihood(c.memory, contextAt(o), c.settings.memory) * extra / 12 * 100 / o.self.entity.maxHp) : 0;
        const setup = estimatedSetup(c, option, path, cast);
        const beforeDistance=Math.hypot(o.self.entity.body.position.x-enemy.position.x,o.self.entity.body.position.y-enemy.position.y),progress=Math.max(0,beforeDistance-band[1])-Math.max(0,endDistance-band[1]);
        branches.push({ progress, damage: earned * 100 / enemyMax, meanLoss: meanLoss * 100 / o.self.entity.maxHp, rawLoss: rawLoss * 100 / o.self.entity.maxHp, kill: earned >= enemyHp ? 1 : 0, death, earlyRisk: earlyRisk * 100 / o.self.entity.maxHp, quality: positionQuality(endOwn, endEnemy, o.arena.width, band, o.self.passives.length > 0), residual, hitTicks: attacks.map(h => h.tick), setup: setup.value, setupReason: setup.reason });
    }
    const weighted = (get: (b: Branch) => number): number => branches.reduce((sum, b, i) => sum + get(b) * c.belief.hypotheses[i]!.weight, 0);
    return { ...empty, expectedDamageDealtPct: weighted(b => b.damage), meanDamageTakenPct: weighted(b => b.meanLoss), worstDamageTakenPct: Math.max(...branches.map(b => b.rawLoss)), killLikelihood: weighted(b => b.kill), deathLikelihood: weighted(b => b.death), positionQualityBefore: positionQuality(bodyOf(o), enemy, o.arena.width, band, o.self.passives.length > 0), positionQualityAfter: weighted(b => b.quality), bandProgressPx:weighted(b=>b.progress), residualExposurePct: weighted(b => b.residual), setupValue: weighted(b => b.setup), confidence: c.belief.confidence * (grid.budgetExceeded ? .5 : 1), earlyRiskPct: weighted(b => b.earlyRisk), hitTicks: [...new Set(branches.flatMap(b => b.hitTicks))].sort((a, b) => a - b), segmentsUsed: grid.ticks.length - 1, budgetExceeded: grid.budgetExceeded, setupReason: branches[0]?.setupReason ?? 'none' };
}
