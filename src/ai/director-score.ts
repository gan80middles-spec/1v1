import type { CandidateTrace } from '../contracts/ai.js';
import { cueIntensity } from '../contracts/pacing.js';
import type { PredictionContext } from './prediction.js';
import { clamp01, distanceBand } from './abilities.js';
export function applyDirectorScores(c: PredictionContext, candidates: CandidateTrace[], continuation: CandidateTrace | null | undefined, threatened = false): void {
    const o = c.observation, cue = o.directorCue;
    if (!cue)
        return;
    const profile = c.content.source.pacingProfiles.find(p => p.id === cue.profileId && p.version === cue.profileVersion);
    if (!profile)
        throw new Error('Unknown director cue profile');
    const intensity = cueIntensity(cue, o.nowTick, profile.rampTicks), best = Math.max(...candidates.filter(v => !v.selectionBlockReason).map(v => v.score?.Uraw ?? -Infinity)), death = continuation?.outcome?.deathLikelihood ?? 0;
    const band = distanceBand(o, c.content, c.profile, o.nowTick - c.memory.lastEffectiveInteractionTick, threatened), enemy = c.belief.opponent, distance = enemy ? Math.hypot(enemy.position.x - o.self.entity.body.position.x, enemy.position.y - o.self.entity.body.position.y) : null, outside = distance !== null && (distance < band[0] || distance > band[1]);
    const mitigationReference = continuation?.outcome?.meanDamageTakenPct ?? candidates.filter(v => v.option.slot !== 'ultimate' && v.outcome).sort((a, b) => b.score!.Uraw - a.score!.Uraw)[0]?.outcome?.meanDamageTakenPct ?? 0;
    for (const v of candidates) {
        if (!v.score || !v.outcome)
            continue;
        const s = v.score, Ubase = s.Uraw;
        let raw = 0, cap = Infinity, reason = 'no-opportunity';
        if (cue.kind === 'engage' && outside && v.outcome.bandProgressPx > 0) {
            // Credit the fraction of the remaining gap closed. Near the reachable band,
            // a useful final step should not disappear under a fixed 120 px denominator.
            const progressScale = profile.engageModel === 'gap-relative-v1' && distance !== null ?
                Math.max(20, Math.min(120, distance - band[1])) : 120;
            raw = intensity * 1.2 * clamp01(v.outcome.bandProgressPx / progressScale);
            cap = Math.max(0, 2.5 - s.stuckBonus);
            reason = 'improve-available-distance-band';
        }
        if (cue.kind === 'vary' && v.option.slot) {
            const misses = (cue.liveEvidence?.evidence ?? cue.evidence).misses.find(m => m.actorId === o.self.entity.id && m.slot === v.option.slot)?.count ?? 0;
            raw = -intensity * .6 * clamp01(misses / 3);
            cap = Math.max(0, 1 - s.R);
            reason = 'confirmed-ineffective-slot';
        }
        if (cue.kind === 'showcase' && v.option.slot === 'ultimate' && (s.D > 0 || mitigationReference - v.outcome.meanDamageTakenPct >= 2 || v.outcome.setupValue >= .5)) {
            raw = intensity * .8;
            reason = 'effective-ultimate-opportunity';
        }
        const baseAllowed = Ubase >= best - 1.2, riskAllowed = v.outcome.deathLikelihood <= death + .05, applied = raw === 0 ? 0 : raw > 0 ? baseAllowed && riskAllowed ? Math.min(raw, cap) : 0 : -Math.min(-raw, cap);
        s.Ubase = Ubase;
        s.Uraw = Ubase + applied;
        s.director = { cueId: cue.id, kind: cue.kind, intensity, raw, applied, baseAllowed, riskAllowed, stackCap: Number.isFinite(cap) ? cap : cue.kind === 'showcase' ? .8 : 1.2, reason };
    }
}
