import type { InputReplay, RenderFrame } from '../contracts/fighter.js';
export function wilson(wins: number, n: number): readonly [
    number,
    number
] | null { if (!n)
    return null; const z = 1.959963984540054, p = wins / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, h = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d; return [Math.max(0, c - h), Math.min(1, c + h)]; }
export function behaviorMetrics(replay: InputReplay, frames: readonly RenderFrame[], entityId: number) {
    const events = replay.events, casts = events.filter(e => e.type === 'CastAccepted').filter(e => e.sourceId === entityId), hits = new Set(events.filter(e => e.type === 'HitResolved').filter(e => e.sourceId === entityId).map(e => e.payload.castId)), basics = casts.filter(e => e.payload.slot === 'basic'), skills = casts.filter(e => e.payload.slot !== 'basic'), damage = events.filter(e => e.type === 'DamageResolved'), requests = replay.inputs.filter(e => e.intents[entityId - 1]?.requestId !== null).length, rejected = events.filter(e => e.type === 'ActionRejected' && e.sourceId === entityId).length;
    let flips = 0, last = 0, wallTicks = 0, longWall = false, wallRun = 0, maxReadyWait = 0, readyRun = 0, approach = 0, moving = 0, distanceSum = 0;
    for (let t = 0; t < replay.inputs.length; t++) {
        const input = replay.inputs[t]!.intents[entityId - 1]!, frame = frames[t]!, own = frame.entities.find(e => e.id === entityId)!, enemy = frame.entities.find(e => e.id !== entityId)!;
        if (input.moveX !== 0) {
            if (last !== 0 && last !== input.moveX)
                flips++;
            last = input.moveX;
            moving++;
            if (input.moveX * (enemy.position.x - own.position.x) > 0)
                approach++;
        }
        const width = replay.content.arenas.find(a => a.id === replay.config.arenaId)!.width, pushing = input.moveX === -1 && own.position.x - own.radius <= 8 || input.moveX === 1 && width - own.radius - own.position.x <= 8, past = frames[Math.max(0, t - 30)]!.entities.find(e => e.id === entityId)!;
        if (pushing && Math.abs(own.position.x - past.position.x) < 8) {
            wallTicks++;
            wallRun++;
            longWall ||= wallRun > 120;
        }
        else
            wallRun = 0;
        readyRun = own.energy >= 100 ? readyRun + 1 : 0;
        maxReadyWait = Math.max(maxReadyWait, readyRun);
        distanceSum += Math.hypot(own.position.x - enemy.position.x, own.position.y - enemy.position.y);
    }
    const effective = skills.filter(e => hits.has(e.payload.castId) || events.some(v => v.type === 'DamagePrevented' && v.sourceId === entityId && v.payload.castId === e.payload.castId) || (() => { const ability = replay.content.abilities.find(a => a.id === e.payload.abilityId)!; if (ability.tags.includes('mobility')) {
        const start = frames[e.tick]!.entities.find(f => f.id === entityId)!, end = frames[Math.min(frames.length - 1, e.tick + ability.startupTicks + ability.activeTicks)]!.entities.find(f => f.id === entityId)!;
        return Math.hypot(start.position.x - end.position.x, start.position.y - end.position.y) >= 20;
    } if (ability.tags.includes('buff'))
        return events.some(v => v.type === 'PassiveTriggered' && v.sourceId === entityId && v.tick >= e.tick + ability.startupTicks && v.tick < e.tick + ability.startupTicks + 240); return false; })()).length;
    const active = new Set<number>();
    for (const d of damage)
        for (let t = d.tick; t < Math.min(replay.inputs.length, d.tick + 60); t++)
            active.add(t);
    const n = replay.inputs.length;
    return { basicCasts: basics.length, basicMisses: basics.filter(e => !hits.has(e.payload.castId)).length, basicMissRate: basics.length ? basics.filter(e => !hits.has(e.payload.castId)).length / basics.length : null, skillCasts: skills.length, effectiveSkills: effective, skillEffectiveRate: skills.length ? effective / skills.length : null, requests, rejectedRequests: rejected, invalidRequestRate: requests ? rejected / requests : null, directionFlipsPerSecond: flips / (n / 60), wallStallFraction: wallTicks / n, longWallStall: longWall, firstInteractionSeconds: damage.length ? damage[0]!.tick / 60 : null, effectiveInteractionFraction: active.size / n, maxFullEnergyWaitSeconds: maxReadyWait / 60, meanCenterDistance: distanceSum / n, activeApproachFraction: moving ? approach / moving : null };
}
