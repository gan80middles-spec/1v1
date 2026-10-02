import type { InputReplay, RenderFrame } from '../contracts/fighter.js';
import { evaluationMetrics } from './evaluation.js';
export const PACING_METRICS_VERSION = 'pacing-v1';
export function pacingMetrics(replay: InputReplay, frames: readonly RenderFrame[]) {
    const a = evaluationMetrics(replay, frames, 1), b = evaluationMetrics(replay, frames, 2), n = replay.inputs.length;
    const interactions: number[] = [];
    let damage = 0;
    for (const e of replay.events) {
        let effective = false;
        if (e.type === 'DamageResolved') {
            damage += e.payload.amount;
            if (damage >= 1) {
                effective = true;
                damage = 0;
            }
        }
        if (e.type === 'DamagePrevented' && e.payload.preventedDamage > 0 || e.type === 'ProjectileReflected' || e.type === 'ProjectileDissipated') {
            effective = true;
            damage = 0;
        }
        if (effective && interactions.at(-1) !== e.tick)
            interactions.push(e.tick);
    }
    const gaps: number[] = [];
    let previous = 0;
    for (const tick of interactions) {
        gaps.push(tick - previous);
        previous = tick;
    }
    gaps.push(n - previous);
    const active = new Set<number>();
    for (const tick of interactions)
        for (let t = tick; t < Math.min(n, tick + 60); t++)
            active.add(t);
    const damageByCast = new Map<string,number>();
    for (const event of replay.events) if (event.type === 'DamageResolved') {const key = `${event.sourceId}:${event.payload.castId}`; damageByCast.set(key,(damageByCast.get(key) ?? 0)+event.payload.amount);}
    const effective = new Set(replay.events.flatMap(e => e.type === 'DamageResolved' && e.payload.amount >= 1 || e.type === 'DamagePrevented' && e.payload.preventedDamage > 0 ? [`${e.sourceId}:${e.payload.castId}`] : (e.type === 'ProjectileReflected' || e.type === 'ProjectileDissipated') && e.payload.defenseCastId !== null ? [`${e.sourceId}:${e.payload.defenseCastId}`] : []));
    for (const [key,damage] of damageByCast) if (damage >= 1) effective.add(key);
    let repeatedMisses = 0;
    const recent = new Map<string, {
        tick: number;
        effective: boolean;
    }[]>();
    for (const cast of replay.events.filter(e => e.type === 'CastAccepted')) {
        const ability = replay.content.abilities.find(x => x.id === cast.payload.abilityId)!, deadline = cast.tick + Math.max(ability.startupTicks + ability.activeTicks + ability.recoveryTicks, ...ability.timeline.flatMap(t => t.effects.map(f => t.offsetTick + (f.kind === 'projectile' ? f.lifetimeTicks : f.kind === 'status' ? replay.content.statuses.find(s => s.id === f.statusId)!.durationTicks : f.kind === 'hitbox' ? f.durationTicks : 0))));
        if (deadline >= n)
            continue;
        const key = `${cast.sourceId}:${cast.payload.slot}`, uses = (recent.get(key) ?? []).filter(u => u.tick >= deadline - 180), hit = effective.has(`${cast.sourceId}:${cast.payload.castId}`);
        // Basic/projectile repeats are measurable from completed public damage/defense results.
        if (!ability.tags.some(t => t === 'buff' || t === 'mobility' || t === 'defense')) {
            if (hit)
                uses.length = 0;
            else if (uses.length >= 2)
                repeatedMisses++;
            uses.push({ tick: deadline, effective: hit });
            recent.set(key, uses);
        }
    }
    const totalDamage = a.damageDealt + b.damageDealt, participation = totalDamage ? Math.min(a.damageDealt, b.damageDealt) / totalDamage : 0;
    return { ticks: n, durationSeconds: n / 60, coldGapsTicks: gaps, coldIntervalsTicks: gaps.filter(t => t >= 180), longestColdTicks: Math.max(...gaps), interactionFraction: active.size / n, basicCasts: a.basicCasts + b.basicCasts, basicMisses: a.basicMisses + b.basicMisses, repeatedConfirmedAttackMisses: repeatedMisses, ultimateCasts: a.ultimateCasts + b.ultimateCasts, effectiveUltimates: a.effectiveUltimates + b.effectiveUltimates, requests: a.requests + b.requests, rejectedRequests: a.rejectedRequests + b.rejectedRequests, damage: [a.damageDealt, b.damageDealt], participation, oneSided: participation < .2, abilities: [a.byAbility, b.byAbility], fullEnergyMaxSeconds: Math.max(a.maxFullEnergyWaitSeconds, b.maxFullEnergyWaitSeconds) };
}
