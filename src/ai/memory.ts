import type { ContentBundle } from '../contracts/content.js';
import type { AIProfile } from '../contracts/content-schema.js';
import type { Observation } from '../contracts/fighter.js';
import type { AIMemory, ContextKind, EncounterOutcome, ExecutionMemory, PendingOwnResult, UtilitySettings } from '../contracts/ai.js';
import type { Slot } from '../contracts/versions.js';
import { abilityFor, clamp01 } from './abilities.js';
export function emptyMemory(): AIMemory { return { lastVisibleEventSeq: 0, encounters: [], recentOwnResults: [], lastEffectiveInteractionTick: 0, ultimateReadySinceTick: null, lastPositions: [], opponentCooldownEstimates: [], pendingEncounter: null, pendingOwnResults: [], stuckUntilTick: 0, blockedMoveX: 0, blockedSinceTick: null, lastEncounterStartedTick: -45, lastSensedTick: null, lastDistance: null, insideBand: false, retreatSinceTick: null, lastHp: null, lastMatureProjectileIds: [], diagnostics: [] }; }
export function emptyExecution(): ExecutionMemory { return { optionKey: null, moveX: 0, selectedTick: 0, minimumHoldUntilTick: 0, activeRequestId: null, triggerSent: false, expectedFinishTick: null, lastReceiptSeq: 0, nextRequestId: 1, activeSlot: null, activeAimX: 1, activeStartedTick: null }; }
export function resultDeadline(content: ContentBundle, characterId: string, slot: Slot, startedTick: number, delay: number): {
    finalEffectTick: number;
    resultDueTick: number;
} {
    const a = abilityFor(content, characterId, slot);
    let end = a.startupTicks + a.activeTicks + a.recoveryTicks;
    for (const entry of a.timeline)
        for (const e of entry.effects) {
            const duration = e.kind === 'projectile' ? e.lifetimeTicks : e.kind === 'hitbox' ? e.durationTicks : e.kind === 'status' ? content.source.statuses.find(s => s.id === e.statusId)!.durationTicks : 1;
            end = Math.max(end, entry.offsetTick + duration);
        }
    return { finalEffectTick: startedTick + end, resultDueTick: Math.min(startedTick + 360, startedTick + end + 1 + delay) };
}
export function beginOwnResult(m: AIMemory, o: Observation, content: ContentBundle, profile: AIProfile, slot: Slot, requestId: number, aimX: -1 | 1): void {
    const a = abilityFor(content, o.self.entity.characterId, slot);
    const p: PendingOwnResult = { requestId, castId: null, slot, abilityId: a.id, startedTick: o.nowTick, aimX, startPosition: { ...o.self.entity.body.position }, ...resultDeadline(content, o.self.entity.characterId, slot, o.nowTick, profile.reactionDelayTicks), effective: null, accepted: false, finished: false };
    m.pendingOwnResults.push(p);
    if (m.pendingOwnResults.length > 16)
        throw new Error('AI pending result budget exceeded');
}
export function posterior(m: AIMemory, context: ContextKind): {
    count: number;
    probabilities: Record<EncounterOutcome, number>;
} {
    const items = m.encounters.filter(e => e.context === context), p: Record<EncounterOutcome, number> = { basic: 2, skill: 2, jump: 2, retreat: 2, other: 2 };
    for (const e of items)
        p[e.outcome]++;
    for (const key of Object.keys(p) as EncounterOutcome[])
        p[key] /= items.length + 10;
    return { count: items.length, probabilities: p };
}
export function contextAt(o: Observation): ContextKind { return !o.self.entity.body.grounded || !o.opponent?.grounded ? 'air' : Math.hypot(o.self.entity.body.position.x - o.opponent.position.x, o.self.entity.body.position.y - o.opponent.position.y) <= 140 ? 'near-ground' : 'far-ground'; }
function ownSourcePosition(m: AIMemory, tick: number, fallback: Observation['self']['entity']['body']['position']) {
    const a = m.lastPositions.findLast(p => p.tick <= tick), b = m.lastPositions.find(p => p.tick >= tick);
    if (!a)
        return fallback;
    if (!b || a.tick === b.tick)
        return a.position;
    const f = (tick - a.tick) / (b.tick - a.tick);
    return { x: a.position.x + (b.position.x - a.position.x) * f, y: a.position.y + (b.position.y - a.position.y) * f };
}
export function consumeMemory(m: AIMemory, e: ExecutionMemory, o: Observation, content: ContentBundle, profile: AIProfile, settings: UtilitySettings, band: readonly [
    number,
    number
]): {
    interrupted: boolean;
    majorVisibleChange: boolean;
} {
    let interrupted = false;
    const own = o.self.entity, now = o.nowTick;
    if (m.lastHp !== null && own.hp < m.lastHp)
        m.lastEffectiveInteractionTick = now;
    m.lastHp = own.hp;
    if (own.energy >= 100 && m.ultimateReadySinceTick === null)
        m.ultimateReadySinceTick = now;
    if (own.energy < 100)
        m.ultimateReadySinceTick = null;
    if (now % 3 === 0 && !m.lastPositions.some(p => p.tick === now))
        m.lastPositions.push({ tick: now, position: { ...own.body.position }, grounded: own.body.grounded });
    m.lastPositions = m.lastPositions.filter(p => p.tick >= now - 180).slice(-61);
    for (const r of [...o.self.receipts].sort((a, b) => a.receiptSeq - b.receiptSeq)) {
        if (r.receiptSeq <= e.lastReceiptSeq)
            continue;
        e.lastReceiptSeq = r.receiptSeq;
        const pending = m.pendingOwnResults.find(p => p.requestId === r.requestId);
        if (pending) {
            if (r.result === 'accepted') {
                pending.accepted = true;
                if (own.action.kind === 'cast' && own.action.requestId === r.requestId)
                    pending.castId = own.action.castId;
            }
            if (r.result === 'rejected') {
                pending.finished = true;
                pending.finalEffectTick = r.tick;
                pending.resultDueTick = r.tick + 1 + profile.reactionDelayTicks;
            }
            if (r.result === 'finished' || r.result === 'interrupted')
                pending.finished = true;
            if (r.result === 'interrupted') {
                const a = content.source.abilities.find(a => a.id === pending.abilityId)!, age = r.tick - pending.startedTick, emitted = a.timeline.some(t => t.offsetTick <= age && t.effects.some(f => f.kind === 'projectile'));
                if (!(a.scheduledPolicy === 'before-first-emission' && emitted)) {
                    let last = age;
                    for (const t of a.timeline)
                        if (t.offsetTick <= age)
                            for (const f of t.effects) {
                                if (f.kind === 'projectile')
                                    last = Math.max(last, t.offsetTick + f.lifetimeTicks);
                                if (f.kind === 'status')
                                    last = Math.max(last, t.offsetTick + content.source.statuses.find(s => s.id === f.statusId)!.durationTicks);
                            }
                    pending.finalEffectTick = pending.startedTick + last;
                    pending.resultDueTick = Math.min(pending.startedTick + 360, pending.finalEffectTick + 1 + profile.reactionDelayTicks);
                }
            }
        }
        if (r.requestId === e.activeRequestId) {
            if (r.result === 'interrupted' || r.result === 'rejected') {
                interrupted = true;
                e.optionKey = null;
                e.minimumHoldUntilTick = now;
                e.activeRequestId = null;
                e.activeSlot = null;
                e.activeStartedTick = null;
                e.expectedFinishTick = null;
                e.triggerSent = false;
            }
            else if (r.result === 'finished') {
                e.activeRequestId = null;
                if (e.activeSlot !== null) {
                    e.optionKey = null;
                    e.minimumHoldUntilTick = now;
                    e.activeSlot = null;
                    e.activeStartedTick = null;
                    e.expectedFinishTick = null;
                }
                e.triggerSent = false;
            }
        }
    }
    const fresh = [...o.visibleEvents].filter(v => v.seq > m.lastVisibleEventSeq).sort((a, b) => a.sourceTick - b.sourceTick || a.seq - b.seq);
    for (const v of fresh) {
        m.lastVisibleEventSeq = Math.max(m.lastVisibleEventSeq, v.seq);
        const d = v.detail;
        if (d.kind === 'damage' && d.amount > 0) {
            m.lastEffectiveInteractionTick = Math.max(m.lastEffectiveInteractionTick, v.sourceTick);
            if (v.sourceId === own.id) {
                const p = m.pendingOwnResults.find(p => p.castId === d.castId);
                if (p)
                    p.effective = 'hit';
            }
        }
        if (d.kind === 'defend' && v.sourceId === own.id) {
            const p = m.pendingOwnResults.find(p => p.castId === d.castId);
            if (p && d.preventedDamage > 0)
                p.effective = 'defended';
        }
        if (d.kind === 'cast') {
            if (v.sourceId === own.id) {
                const p = m.pendingOwnResults.find(p => p.slot === d.slot && p.startedTick === v.sourceTick);
                if (p)
                    p.castId = d.castId;
            }
            else {
                const a = content.source.abilities.find(a => a.id === d.abilityId);
                if (a) {
                    m.opponentCooldownEstimates = m.opponentCooldownEstimates.filter(c => c.abilityId !== a.id);
                    m.opponentCooldownEstimates.push({ abilityId: a.id, earliestReadyTick: v.sourceTick + a.cooldownTicks, latestReadyTick: v.sourceTick + a.cooldownTicks, confidence: 1 });
                }
            }
        }
        if (d.kind === 'bounce' && d.wall !== undefined && d.wall !== 'floor' && v.sourceId === own.id && d.incomingSpeed >= 250) {
            for (const p of m.pendingOwnResults)
                if (content.source.abilities.find(a => a.id === p.abilityId)!.tags.includes('buff') && v.sourceTick >= p.startedTick + 12 && v.sourceTick < p.finalEffectTick)
                    p.effective = 'repositioned';
        }
        if (settings.memory && m.pendingEncounter && v.sourceId === o.opponent?.id && v.sourceTick >= m.pendingEncounter.startedSourceTick && v.sourceTick <= m.pendingEncounter.startedSourceTick + 30 && m.pendingEncounter.observedOutcome === null) {
            if (d.kind === 'cast')
                m.pendingEncounter.observedOutcome = d.slot === 'basic' ? 'basic' : 'skill';
            if (d.kind === 'jump')
                m.pendingEncounter.observedOutcome = 'jump';
        }
    }
    if (o.opponent?.tell) {
        const tell = o.opponent.tell, a = content.source.abilities.find(a => a.id === tell.abilityId)!;
        if (!m.opponentCooldownEstimates.some(c => c.abilityId === a.id))
            m.opponentCooldownEstimates.push({ abilityId: a.id, earliestReadyTick: tell.visibleSinceTick + a.cooldownTicks, latestReadyTick: tell.visibleSinceTick + a.cooldownTicks, confidence: .9 });
    }
    m.opponentCooldownEstimates = m.opponentCooldownEstimates.filter(c => c.latestReadyTick >= now - 480).slice(-4);
    for (const p of m.pendingOwnResults) {
        if (p.accepted && content.source.abilities.find(a => a.id === p.abilityId)!.tags.includes('mobility') && (own.lastLaunchTick === null || own.lastLaunchTick < p.startedTick) && Math.hypot(own.body.position.x - p.startPosition.x, own.body.position.y - p.startPosition.y) >= 20)
            p.effective ??= 'repositioned';
    }
    const complete = m.pendingOwnResults.filter(p => now >= p.resultDueTick && o.sensedTick !== null && o.sensedTick >= Math.min(p.finalEffectTick + 1, p.startedTick + 360 - profile.reactionDelayTicks));
    for (const p of complete) {
        if (!p.accepted)
            continue;
        m.recentOwnResults.push({ slot: p.slot, completedTick: now, result: p.effective ?? 'miss' });
        const last = m.recentOwnResults.filter(r => r.slot === 'basic').slice(-3);
        if (last.length === 3 && last.every(r => r.result === 'miss') && !m.diagnostics.some(d => d.code === 'THREE_BASIC_MISSES' && now - d.tick < 180))
            m.diagnostics.push({ tick: now, code: 'THREE_BASIC_MISSES' });
    }
    m.pendingOwnResults = m.pendingOwnResults.filter(p => !complete.includes(p));
    m.recentOwnResults = m.recentOwnResults.filter(r => r.completedTick >= now - 480).slice(-12);
    m.diagnostics = m.diagnostics.slice(-16);
    m.encounters = m.encounters.filter(s => s.completedTick >= now - 480).slice(-12);
    if (settings.memory && o.opponent && o.sensedTick !== null && o.sensedTick !== m.lastSensedTick) {
        const pos = ownSourcePosition(m, o.sensedTick, own.body.position), distance = Math.hypot(pos.x - o.opponent.position.x, pos.y - o.opponent.position.y), inside = distance <= band[1];
        if (inside && !m.insideBand && m.lastDistance !== null && !m.pendingEncounter && o.sensedTick - m.lastEncounterStartedTick >= 45) {
            m.pendingEncounter = { startedSourceTick: o.sensedTick, context: !o.opponent.grounded || !own.body.grounded ? 'air' : distance <= 140 ? 'near-ground' : 'far-ground', observedOutcome: null };
            m.lastEncounterStartedTick = o.sensedTick;
        }
        if (m.pendingEncounter && m.pendingEncounter.observedOutcome === null) {
            const event = fresh.find(v => v.sourceId === o.opponent!.id && v.sourceTick >= m.pendingEncounter!.startedSourceTick && v.sourceTick <= m.pendingEncounter!.startedSourceTick + 30 && (v.detail.kind === 'cast' || v.detail.kind === 'jump'));
            if (event)
                m.pendingEncounter.observedOutcome = event.detail.kind === 'jump' ? 'jump' : event.detail.kind === 'cast' && event.detail.slot === 'basic' ? 'basic' : 'skill';
        }
        if (m.lastDistance !== null && distance > m.lastDistance + .01 && o.opponent.velocity.x * (o.opponent.position.x - pos.x) > 0) {
            m.retreatSinceTick ??= o.sensedTick;
            if (m.pendingEncounter && o.sensedTick - m.retreatSinceTick >= 12)
                m.pendingEncounter.observedOutcome ??= 'retreat';
        }
        else
            m.retreatSinceTick = null;
        if (m.pendingEncounter && (m.pendingEncounter.observedOutcome !== null || o.sensedTick >= m.pendingEncounter.startedSourceTick + 30)) {
            m.encounters.push({ startedTick: m.pendingEncounter.startedSourceTick, completedTick: o.sensedTick, context: m.pendingEncounter.context, outcome: m.pendingEncounter.observedOutcome ?? 'other' });
            m.pendingEncounter = null;
        }
        m.encounters = m.encounters.slice(-12);
        m.insideBand = inside;
        m.lastDistance = distance;
        m.lastSensedTick = o.sensedTick;
    }
    const old = m.lastPositions.findLast(p => p.tick <= now - 90);
    if (o.opponent && old && now - m.lastEffectiveInteractionTick >= 90 && Math.hypot(own.body.position.x - o.opponent.position.x, own.body.position.y - o.opponent.position.y) > band[1] && Math.hypot(own.body.position.x - old.position.x, own.body.position.y - old.position.y) < 20)
        m.stuckUntilTick = now + 60;
    const left = own.body.position.x - own.body.radius, right = o.arena.width - own.body.radius - own.body.position.x, pushing = e.moveX === -1 && left <= 8 || e.moveX === 1 && right <= 8;
    if (pushing) {
        m.blockedSinceTick ??= now;
        const start = m.lastPositions.find(p => p.tick >= m.blockedSinceTick!);
        if (now - m.blockedSinceTick >= 30 && start && Math.abs(own.body.position.x - start.position.x) < 8)
            m.blockedMoveX = e.moveX;
    }
    else
        m.blockedSinceTick = null;
    if (m.blockedMoveX === -1 && left > 40 || m.blockedMoveX === 1 && right > 40)
        m.blockedMoveX = 0;
    const ids = o.projectiles.filter(p => p.ownerId !== own.id).map(p => p.id).sort((a, b) => a - b), majorVisibleChange = ids.some(id => !m.lastMatureProjectileIds.includes(id)) || fresh.some(v => v.sourceId !== own.id && v.detail.kind === 'cast');
    m.lastMatureProjectileIds = ids;
    return { interrupted, majorVisibleChange };
}
export function repeatPenalty(m: AIMemory, slot: Slot | null, now: number): number { return slot === null ? 0 : Math.min(.75, m.recentOwnResults.filter(r => r.slot === slot && r.result === 'miss' && r.completedTick >= now - 180).slice(-3).length * .25); }
export function possibleBasicLikelihood(m: AIMemory, context: ContextKind, enabled: boolean): number { const p = posterior(m, context); return enabled && p.count >= 4 ? .35 + Math.max(-.15, Math.min(.15, (p.probabilities.basic - .2) * .75)) : .35; }
export function adaptiveWeights(m: AIMemory, context: ContextKind, enabled: boolean): {
    weights: readonly [
        number,
        number,
        number
    ];
    adapted: boolean;
} { const p = posterior(m, context); if (!enabled || p.count < 4)
    return { weights: [.5, .25, .25], adapted: false }; const d = Math.max(-.15, Math.min(.15, (p.probabilities.basic + p.probabilities.skill - p.probabilities.retreat - .2) * .5)); return { weights: [.5, .25 + d, .25 - d], adapted: true }; }
export const reserveFactor = (readyAgeTicks: number): number => Math.max(.25, 1 - clamp01(readyAgeTicks / 600));
