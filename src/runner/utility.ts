import type { ContentBundle } from '../contracts/content.js';
import type { BattleEvent, FighterConfig, InputEntry, InputReplay, RenderFrame } from '../contracts/fighter.js';
import { AI_VERSION, UTILITY_BUILD, DEFAULT_UTILITY_SETTINGS, type AITrace, type FullCheckpoint, type UtilityRunnerOptions } from '../contracts/ai.js';
import { FullCheckpointSchema } from '../contracts/ai-schema.js';
import { deepFreeze, canonicalSerialize } from '../math/canonical.js';
import { hashCanonical } from '../math/hash.js';
import { deriveParticipantSeed } from '../math/random.js';
import { fighterWorldHash } from '../sim/fighter-state.js';
import { FighterSimulation } from '../sim/fighter.js';
import { UtilityController } from '../ai/utility.js';
import { BaselineController } from '../ai/scripted.js';
import { ObservationBuffer } from './observation.js';
import { renderFrame } from '../replay/frame.js';
export class UtilityRunner {
    readonly sim: FighterSimulation;
    readonly controllers: readonly [
        UtilityController | BaselineController,
        UtilityController | BaselineController
    ];
    readonly observations: ObservationBuffer;
    readonly inputs: InputEntry[] = [];
    readonly events: BattleEvent[] = [];
    readonly checkpoints: {
        tick: number;
        worldHash: string;
    }[] = [];
    readonly frames: RenderFrame[] = [];
    readonly traces: {
        entityId: number;
        trace: AITrace;
    }[] = [];
    readonly options: UtilityRunnerOptions;
    private recorderCursor = 0;
    private recordingComplete = true;
    constructor(readonly content: ContentBundle, readonly config: FighterConfig, options: Partial<UtilityRunnerOptions> = {}) {
        this.options = { kinds: options.kinds ?? ['utility', 'utility'], settings: options.settings ?? { ...DEFAULT_UTILITY_SETTINGS }, trace: options.trace ?? false, recordFrames: options.recordFrames ?? true };
        if (config.pacing.mode !== 'off')
            throw new Error('Phase 2 requires pacing off');
        this.sim = new FighterSimulation(content, config, undefined, UTILITY_BUILD);
        const make = (index: 0 | 1): UtilityController | BaselineController => { const seed = deriveParticipantSeed(config.seed, config.participants[index].participantId), kind = this.options.kinds[index]; return kind === 'utility' ? new UtilityController(seed, content, content.source.profiles.find(p => p.id === config.participants[index].profileId)!, this.options.settings, this.options.trace) : new BaselineController(kind, seed, content); };
        this.controllers = [make(0), make(1)];
        this.observations = new ObservationBuffer(content);
        this.observations.push(this.sim.snapshot(), [], []);
        this.checkpoints.push({ tick: 0, worldHash: fighterWorldHash(this.sim.snapshot()) });
        if (this.options.recordFrames)
            this.frames.push(renderFrame(this.sim.snapshot()));
    }
    step(): void {
        const w = this.sim.snapshot();
        if (w.result)
            throw new Error('Cannot step completed match');
        const a = this.observations.observe(w, 0), b = this.observations.observe(w, 1), intents = [this.controllers[0].update(a), this.controllers[1].update(b)] as const;
        this.inputs.push({ tick: w.tick, intents });
        this.recorderCursor++;
        for (const index of [0, 1] as const) {
            const ctrl = this.controllers[index];
            if (ctrl instanceof UtilityController && ctrl.lastTrace)
                this.traces.push({ entityId: w.entities[index].id, trace: ctrl.lastTrace });
        }
        const out = this.sim.step(intents);
        this.events.push(...out.events);
        this.observations.push(out.state, out.events, out.receipts);
        if (out.state.tick % 60 === 0 || out.state.result)
            this.checkpoints.push({ tick: out.state.tick, worldHash: fighterWorldHash(out.state) });
        if (this.options.recordFrames)
            this.frames.push(renderFrame(out.state));
    }
    run(): InputReplay { while (!this.sim.snapshot().result)
        this.step(); return this.replay(); }
    replay(): InputReplay { const result = this.sim.snapshot().result; if (!result || !this.recordingComplete)
        throw new Error('Replay requires completed match and complete input recording'); return deepFreeze({ replaySchemaVersion: 2, engineBuild: UTILITY_BUILD, config: this.config, content: this.content.source, pluginVersions: this.content.pluginVersions, inputs: [...this.inputs], events: [...this.events], checkpoints: [...this.checkpoints], finalWorldHash: fighterWorldHash(this.sim.snapshot()), result }); }
    snapshot(includeRecording = false): FullCheckpoint {
        const controllers = this.controllers.map((c, i) => ({ kind: this.options.kinds[i], data: c.snapshot() })) as unknown as FullCheckpoint['controllers'];
        const future = { checkpointVersion: 1 as const, engineBuild: UTILITY_BUILD, aiVersion: AI_VERSION, contentHash: this.content.bundleHash, config: this.config, nextTick: this.sim.snapshot().tick, world: this.sim.snapshot(), controllers, observations: this.observations.snapshot(), settings: this.options.settings, pacingDirector: null, recorderCursor: this.recorderCursor };
        return deepFreeze({ ...future, runnerHash: hashCanonical(future), ...(includeRecording && this.recordingComplete ? { recording: { inputs: [...this.inputs], events: [...this.events], checkpoints: [...this.checkpoints] } } : {}) });
    }
    runnerHash(): string { return this.snapshot().runnerHash; }
    restore(input: unknown): void {
        const cp = FullCheckpointSchema.parse(input), { runnerHash, recording, ...future } = cp;
        if (hashCanonical(future) !== runnerHash)
            throw new Error('Checkpoint runnerHash mismatch');
        if (cp.contentHash !== this.content.bundleHash || canonicalSerialize(cp.config) !== canonicalSerialize(this.config) || canonicalSerialize(cp.settings) !== canonicalSerialize(this.options.settings) || cp.nextTick !== cp.world.tick || cp.recorderCursor !== cp.nextTick)
            throw new Error('Checkpoint config/cursor mismatch');
        if (cp.observations.ring.at(-1)?.tick !== cp.nextTick || cp.observations.pending.some(r => r.tick >= cp.nextTick))
            throw new Error('Checkpoint observation/receipt cursor mismatch');
        for (let i = 0; i < 2; i++) {
            const saved = cp.controllers[i]!, controller = this.controllers[i]!;
            if (saved.kind !== this.options.kinds[i])
                throw new Error('Checkpoint controller kind mismatch');
            if (controller instanceof UtilityController) {
                if (saved.kind !== 'utility')
                    throw new Error('Checkpoint controller mismatch');
                controller.restore(saved.data);
            }
            else {
                if (saved.kind === 'utility')
                    throw new Error('Checkpoint controller mismatch');
                controller.restore(saved.data);
            }
        }
        this.sim.restore(cp.world);
        this.observations.restore(cp.observations);
        this.recorderCursor = cp.recorderCursor;
        this.inputs.length = 0;
        this.events.length = 0;
        this.checkpoints.length = 0;
        this.frames.length = 0;
        this.traces.length = 0;
        this.recordingComplete = Boolean(recording) || cp.nextTick === 0;
        if (recording) {
            if (recording.inputs.length !== cp.recorderCursor || recording.inputs.some((r, i) => r.tick !== i) || recording.events.some(e => e.tick >= cp.nextTick) || recording.checkpoints.some(c => c.tick > cp.nextTick))
                throw new Error('Checkpoint recording cursor mismatch');
            this.inputs.push(...recording.inputs);
            this.events.push(...recording.events);
            this.checkpoints.push(...recording.checkpoints);
        }
        else if (cp.nextTick === 0)
            this.checkpoints.push({ tick: 0, worldHash: fighterWorldHash(cp.world) });
        if (this.options.recordFrames)
            this.frames.push(renderFrame(cp.world));
    }
}
