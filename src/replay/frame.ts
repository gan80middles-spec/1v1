import type { RenderFrame, WorldView, PublicSnapshot, PublicEvent, BattleEvent } from '../contracts/fighter.js';
import type { ContentBundle } from '../contracts/content.js';
import { actionPhase } from '../math/fighter-phase.js';
import { deepFreeze } from '../math/canonical.js';
export function renderFrame(w: WorldView): RenderFrame {
    return deepFreeze({ tick: w.tick, entities: w.entities.map(e => ({ id: e.id, characterId: e.characterId, position: { ...e.body.position }, velocity: { ...e.body.velocity }, radius: e.body.radius, facing: e.body.facing, hp: e.hp, maxHp: e.maxHp, energy: e.energy, grounded: e.body.grounded, actionPhase: actionPhase(e, w.tick), abilityId: e.action.kind === 'cast' ? e.action.abilityId : null, visibleStatusIds: e.statuses.filter(s => s.expiresTick > w.tick).map(s => s.definitionId), cooldownReadyTick: { ...e.cooldownReadyTick }, wallStacks: w.passiveRuntime.find(r => r.entityId === e.id && r.expiresTick > w.tick)?.stacks ?? 0 })), projectiles: w.projectiles.map(p => ({ id: p.id, ownerId: p.ownerId, position: { ...p.position }, radius: p.radius })), hitboxes: w.hitboxes.map(h => { const e = w.entities.find(e => e.id === h.ownerId)!; return { id: h.id, position: { x: e.body.position.x + h.localOffset.x * h.aimX, y: e.body.position.y + h.localOffset.y }, radius: h.radius }; }), result: w.result });
}
export function publicSnapshot(w: WorldView, events: readonly BattleEvent[], content: ContentBundle): PublicSnapshot {
    const visible: PublicEvent[] = events.flatMap((e): PublicEvent[] => {
        const base = { seq: e.seq, sourceTick: e.tick, sourceId: e.sourceId, targetId: e.targetId };
        switch (e.type) {
            case 'CastAccepted': return [{ ...base, detail: { kind: 'cast', castId: e.payload.castId, abilityId: e.payload.abilityId, slot: e.payload.slot } }];
            case 'DamageResolved': return [{ ...base, detail: { kind: 'damage', castId: e.payload.castId, amount: e.payload.amount } }];
            case 'WallBounce': return [{ ...base, detail: { kind: 'bounce', incomingSpeed: e.payload.incomingNormalSpeed, wall: e.payload.wall } }];
            case 'Jumped': return [{ ...base, detail: { kind: 'jump' } }];
            case 'DamagePrevented': return [{ ...base, detail: { kind: 'defend', castId: e.payload.castId, preventedDamage: e.payload.preventedDamage } }];
            case 'EntityDied': return [{ ...base, detail: { kind: 'death' } }];
            default: return [];
        }
    });
    return deepFreeze({ tick: w.tick, fighters: w.entities.map(e => { const phase = actionPhase(e, w.tick); return { id: e.id, characterId: e.characterId, position: { ...e.body.position }, velocity: { ...e.body.velocity }, radius: e.body.radius, facing: e.body.facing, grounded: e.body.grounded, hpRatio: e.hp / e.maxHp, energyBand: e.energy >= 100 ? 'ready' as const : e.energy >= 50 ? 'mid' as const : 'low' as const, tell: e.action.kind === 'cast' && (phase === 'startup' || phase === 'active' || phase === 'recovery') ? { abilityId: e.action.abilityId, phase, visibleSinceTick: e.action.startedTick } : null, visibleStatusIds: e.statuses.filter(s => s.expiresTick > w.tick).map(s => s.definitionId) }; }), projectiles: w.projectiles.map(p => ({ id: p.id, ownerId: p.ownerId, sourceCastId: p.sourceCastId, abilityId: p.abilityId, position: { ...p.position }, velocity: { ...p.velocity }, radius: p.radius, reflectable: content.source.abilities.find(a => a.id === p.abilityId)!.timeline.some(t => t.effects.some(f => f.kind === 'projectile' && f.reflectable)) })), events: visible });
}
