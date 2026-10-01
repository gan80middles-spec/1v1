import type { ContentBundle } from '../contracts/content.js';
import type { AIProfile } from '../contracts/content-schema.js';
import type { Observation } from '../contracts/fighter.js';
import { AI_VERSION, PHASE3A_AI_VERSION, DEFAULT_UTILITY_SETTINGS, type AITrace, type UtilitySettings, type UtilitySnapshot, type CandidateTrace } from '../contracts/ai.js';
import { UtilitySnapshotSchema } from '../contracts/ai-schema.js';
import { NEUTRAL_INTENT, type ActionIntent } from '../contracts/state.js';
import { deepFreeze } from '../math/canonical.js';
import { hashCanonical } from '../math/hash.js';
import { Xoshiro128ss } from '../math/random.js';
import { decisionChannel } from '../math/decision-random.js';
import { actionPhase } from '../math/fighter-phase.js';
import { abilityFor, distanceBand } from './abilities.js';
import { buildBelief } from './belief.js';
import { emptyMemory, emptyExecution, consumeMemory, beginOwnResult } from './memory.js';
import { generateOptions } from './options.js';
import { buildThreats, describeThreats, predictOutcome, type PredictionContext } from './prediction.js';
import { scoreOption } from './score.js';
import { continuation, eligiblePool, choose } from './selection.js';
export class UtilityController {
    private rng: Xoshiro128ss;
    private get aiVersion(){return this.content.pluginVersions['speed-impact']===1?PHASE3A_AI_VERSION:AI_VERSION;}
    private memory = emptyMemory();
    private execution = emptyExecution();
    private decisionIndex = 0;
    private lastDecisionTick: number | null = null;
    private nextDecisionTick = 0;
    lastTrace: AITrace | null = null;
    get decisionsMade():number {return this.decisionIndex;}
    constructor(seed: number, private content: ContentBundle, readonly profile: AIProfile, readonly settings: UtilitySettings = DEFAULT_UTILITY_SETTINGS, private traceEnabled = true) { this.rng = new Xoshiro128ss(seed); }
    update(o: Observation): ActionIntent {
        this.lastTrace = null;
        const changed = consumeMemory(this.memory, this.execution, o, this.content, this.profile, this.settings, distanceBand(o, this.content, this.profile, o.nowTick - this.memory.lastEffectiveInteractionTick));
        const moving = (): ActionIntent => ({ ...NEUTRAL_INTENT, moveX: o.self.canMove ? this.execution.moveX : 0 });
        if (['dead', 'hitstun'].includes(actionPhase(o.self.entity, o.nowTick)))
            return { ...NEUTRAL_INTENT };
        const since = this.lastDecisionTick === null ? Infinity : o.nowTick - this.lastDecisionTick;
        if (since < 3)
            return moving();
        let emergency = false;
        if ((changed.majorVisibleChange || o.projectiles.some(p => p.ownerId !== o.self.entity.id) || o.opponent?.tell) && o.nowTick < this.nextDecisionTick) {
            const context = this.context(o, 0), models = buildThreats(context), options = generateOptions(o, this.content, context.belief), current = continuation(this.execution, options);
            if (current) {
                const risk = predictOutcome(context, current, models).earlyRiskPct;
                emergency = risk >= 12 && options.filter(p => p.legal).some(p => predictOutcome(context, p, models).earlyRiskPct <= risk - 6);
            }
        }
        if (o.nowTick < this.nextDecisionTick && !changed.interrupted && !emergency)
            return moving();
        const bits = this.rng.nextUint32(), draw = decisionChannel(bits, 1), c = this.context(o, bits), models = buildThreats(c), options = generateOptions(o, this.content, c.belief), before = { ...this.execution };
        const candidates: CandidateTrace[] = options.map(option => { if (!option.legal)
            return { option, outcome: null, score: null, switchMargin: 0, eligible: false }; const outcome = predictOutcome(c, option, models); return { option, outcome, score: scoreOption(c, option, outcome), switchMargin: 0, eligible: false }; });
        const current = continuation(this.execution, options), currentCandidate = current ? candidates.find(v => v.option.key === current.key) : null;
        const currentScore = currentCandidate?.score?.Uraw ?? null, unexpired = current!==null&&o.nowTick < this.execution.minimumHoldUntilTick;
        if (currentCandidate && currentCandidate.outcome!.earlyRiskPct >= 12 && candidates.some(v => v.outcome && v.outcome.earlyRiskPct <= currentCandidate.outcome!.earlyRiskPct - 6))
            emergency = true;
        const pool = eligiblePool(candidates, this.settings.hysteresis===false?null:currentScore, this.settings.hysteresis===false?false:unexpired, emergency, this.profile.nearBestBand), selected = choose(pool, draw, this.settings.randomChoice, this.profile.nearBestBand);
        let input = moving(), selectedKey = current?.key ?? null;
        if (selected) {
            const option = selected.option;
            selectedKey = option.key;
            this.execution.optionKey = option.key;
            this.execution.moveX = option.moveX;
            this.execution.selectedTick = o.nowTick;
            this.execution.minimumHoldUntilTick = o.nowTick + (option.kind === 'move' && option.moveX === 0 ? 6 : 12);
            input = { ...NEUTRAL_INTENT, moveX: option.moveX };
            if (option.kind !== 'move') {
                const requestId = this.execution.nextRequestId++;
                this.execution.activeRequestId = requestId;
                this.execution.triggerSent = true;
                if (option.kind === 'cast') {
                    const a = abilityFor(this.content, o.self.entity.characterId, option.slot!);
                    this.execution.activeSlot = option.slot;
                    this.execution.activeAimX = option.aimX;
                    this.execution.activeStartedTick = o.nowTick;
                    this.execution.expectedFinishTick = o.nowTick + a.startupTicks + a.activeTicks + a.recoveryTicks;
                    beginOwnResult(this.memory, o, this.content, this.profile, option.slot!, requestId, option.aimX);
                    input = { ...input, cast: { slot: option.slot!, aimX: option.aimX }, requestId };
                }
                else {
                    input = { ...input, jumpPressed: true, requestId };
                    this.execution.activeSlot = null;
                    this.execution.activeStartedTick = o.nowTick;
                    this.execution.expectedFinishTick = o.nowTick + 1;
                }
            }
        }
        else if (!current) {
            this.execution.optionKey = null;
            this.execution.moveX = 0;
            input = { ...NEUTRAL_INTENT };
        }
        this.lastDecisionTick = o.nowTick;
        this.nextDecisionTick = o.nowTick + this.profile.decisionIntervalTicks;
        this.decisionIndex++;
        if (this.traceEnabled)
            this.lastTrace = deepFreeze({ aiVersion: this.aiVersion, nowTick: o.nowTick, sensedTick: o.sensedTick, decisionIndex: this.decisionIndex, profileId: this.profile.id, profileVersion: this.profile.version, belief: c.belief, threats: describeThreats(models), candidates, continuationKey: current?.key ?? null, continuationScore: currentScore, selectedKey, poolKeys: pool.map(v => v.option.key), randomBits: bits, choiceDraw: draw, emergency, commitmentHeld: this.settings.hysteresis!==false && unexpired && !emergency, stuck: this.memory.stuckUntilTick > o.nowTick, blockedMoveX: this.memory.blockedMoveX, requestId: input.requestId, input, executionBefore: before });
        return input;
    }
    private context(o: Observation, bits: number): PredictionContext { return { observation: o, content: this.content, profile: this.profile, belief: buildBelief(o, this.content, this.profile, this.memory, bits, this.settings), memory: this.memory, execution: this.execution, settings: this.settings }; }
    snapshot(): UtilitySnapshot { return deepFreeze({ version: 1, aiVersion: this.aiVersion, contentHash: this.content.bundleHash, profile: this.profile, settings: this.settings, decisionIndex: this.decisionIndex, lastDecisionTick: this.lastDecisionTick, nextDecisionTick: this.nextDecisionTick, rngState: this.rng.snapshot(), memory: structuredClone(this.memory), execution: { ...this.execution } }); }
    restore(input: unknown): void { const s = UtilitySnapshotSchema.parse(input); if (s.aiVersion!==this.aiVersion || s.contentHash !== this.content.bundleHash || hashCanonical(s.profile) !== hashCanonical(this.profile) || hashCanonical(s.settings) !== hashCanonical(this.settings))
        throw new Error('Utility checkpoint identity mismatch'); this.rng.restore(s.rngState); this.memory = s.memory; this.execution = s.execution; this.decisionIndex = s.decisionIndex; this.lastDecisionTick = s.lastDecisionTick; this.nextDecisionTick = s.nextDecisionTick; this.lastTrace = null; }
}
