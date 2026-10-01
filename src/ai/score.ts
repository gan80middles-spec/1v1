import type { AIProfile } from '../contracts/content-schema.js';
import type { Option, OutcomeEstimate, UtilityScore } from '../contracts/ai.js';
import { clamp01, abilityFor } from './abilities.js';
import { reserveFactor, repeatPenalty } from './memory.js';
import type { PredictionContext } from './prediction.js';
export function scoreOutcome(out: OutcomeEstimate, profile: AIProfile, hpRatio: number, cost: number, repetition: number, stuckBonus = 0, wallCost = 0): UtilityScore {
    const wD = .8 + .4 * profile.aggression, wL = (2 - 1.2 * profile.riskPreference) * (1 + .5 * clamp01((.3 - hpRatio) / .3)), wP = .8 + .4 * profile.spacing, wC = .8 + .4 * profile.resourcePatience;
    const D = out.expectedDamageDealtPct * out.confidence, L = .75 * out.meanDamageTakenPct + .25 * out.worstDamageTakenPct, P = 3 * (out.positionQualityAfter - out.positionQualityBefore), K = 8 * out.killLikelihood, X = 18 * out.deathLikelihood, C = cost, E = out.residualExposurePct, R = repetition, B = Math.max(0, Math.min(2, out.setupValue));
    const Uraw = wD * D - wL * L + wP * P + K - X - wC * C - wL * E - R + B + stuckBonus - wallCost;
    if ([D, L, P, K, X, C, E, R, B, wD, wL, wP, wC, Uraw, stuckBonus, wallCost].some(n => !Number.isFinite(n)))
        throw new Error('Nonfinite Utility score');
    return { D, L, P, K, X, C, E, R, B, wD, wL, wP, wC, Uraw, stuckBonus, wallCost };
}
export function scoreOption(c: PredictionContext, option: Option, out: OutcomeEstimate): UtilityScore {
    const o = c.observation, a = option.slot ? abilityFor(c.content, o.self.entity.characterId, option.slot) : null;
    const cost = option.kind !== 'cast' ? 0 : option.slot === 'ultimate' ? 6 * reserveFactor(c.memory.ultimateReadySinceTick === null ? 0 : o.nowTick - c.memory.ultimateReadySinceTick) : 2 * a!.cooldownTicks / (a!.cooldownTicks + 120);
    const toward = c.belief.opponent ? Math.sign(c.belief.opponent.position.x - o.self.entity.body.position.x) : 0, stuckBonus = c.memory.stuckUntilTick > o.nowTick && option.moveX === toward && option.moveX !== 0 ? 2*clamp01(out.bandProgressPx/20) : 0, wallCost = c.memory.blockedMoveX !== 0 && option.moveX === c.memory.blockedMoveX ? 2 : 0;
    return scoreOutcome(out, c.profile, o.self.entity.hp / o.self.entity.maxHp, cost, repeatPenalty(c.memory, option.slot, o.nowTick), stuckBonus, wallCost);
}
