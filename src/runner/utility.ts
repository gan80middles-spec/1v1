import { isPhase3AContent } from '../content/phase3a.js';
import { isPhase3BContent } from '../content/phase3b.js';
import { PacingDirector } from '../director/pacing.js';
import type { DirectorRecord } from '../contracts/pacing.js';
import { PHASE3B_BUILD, PHASE3B_AI_VERSION, type UtilityBuild, type AIVersion } from '../contracts/ai.js';
import type { ContentBundle } from '../contracts/content.js';
import type { BattleEvent, FighterConfig, InputEntry, InputReplay, RenderFrame } from '../contracts/fighter.js';
import { AI_VERSION, UTILITY_BUILD, PHASE3A_BUILD, PHASE3A_AI_VERSION, DEFAULT_UTILITY_SETTINGS, type AITrace, type FullCheckpoint, type UtilityRunnerOptions } from '../contracts/ai.js';
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
    readonly engineBuild: UtilityBuild;
    readonly aiVersion:AIVersion;
    readonly director:PacingDirector|null;
    readonly directorDelayTicks:number;
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
        this.config=deepFreeze(structuredClone(config));config=this.config;
        this.options = deepFreeze(structuredClone({ kinds: options.kinds ?? ['utility', 'utility'], settings: options.settings ?? { ...DEFAULT_UTILITY_SETTINGS }, trace: options.trace ?? false, recordFrames: options.recordFrames ?? true,directorLog:options.directorLog??true }));
        if (config.pacing.mode !== 'off'&&!isPhase3BContent(content))throw new Error('Legacy build requires pacing off');
        this.engineBuild=isPhase3BContent(content)?PHASE3B_BUILD:isPhase3AContent(content)?PHASE3A_BUILD:UTILITY_BUILD;
        this.aiVersion=isPhase3BContent(content)?PHASE3B_AI_VERSION:isPhase3AContent(content)?PHASE3A_AI_VERSION:AI_VERSION;
        this.directorDelayTicks=Math.max(...config.participants.map(p=>content.source.profiles.find(x=>x.id===p.profileId)!.reactionDelayTicks))+1;
        const pacingProfile=content.source.pacingProfiles.find(p=>p.id===config.pacing.profileId);
        if(config.pacing.mode!=='off'&&!pacingProfile)throw new Error('Unknown pacing profile');
        this.director=config.pacing.mode==='off'?null:new PacingDirector(content,pacingProfile!,config.pacing.mode,this.options.directorLog,this.directorDelayTicks);
        this.sim = new FighterSimulation(content, config, undefined, this.engineBuild);
        const make = (index: 0 | 1): UtilityController | BaselineController => { const seed = deriveParticipantSeed(config.seed, config.participants[index].participantId), kind = this.options.kinds[index]; return kind === 'utility' ? new UtilityController(seed, content, content.source.profiles.find(p => p.id === config.participants[index].profileId)!, this.options.settings, this.options.trace) : new BaselineController(kind, seed, content, { noise: this.options.settings.noise, profileId: config.participants[index].profileId }); };
        this.controllers = [make(0), make(1)];
        this.observations = new ObservationBuffer(content,Math.max(64,this.directorDelayTicks+(this.director?.profile.sampleIntervalTicks??0)+2));
        this.observations.push(this.sim.snapshot(), [], []);
        this.checkpoints.push({ tick: 0, worldHash: fighterWorldHash(this.sim.snapshot()) });
        if (this.options.recordFrames)
            this.frames.push(renderFrame(this.sim.snapshot()));
    }
    step(): void {
        const w = this.sim.snapshot();
        if (w.result)
            throw new Error('Cannot step completed match');
        if(this.director&&w.tick===this.director.nextUpdateTick)this.director.update(this.observations.maturedSince(this.director.lastConsumedSnapshotTick,w.tick-this.directorDelayTicks),w.tick);
        const observe=(index:0|1)=>{const o=this.observations.observe(w,index),cue=this.director?.currentCue;return this.config.pacing.mode==='pace'&&cue&&w.tick>=cue.applyTick&&w.tick<cue.expiresTick&&o.sensedTick!==null&&o.sensedTick>=Math.max(cue.basedOnTick,cue.liveEvidence?.basedOnTick??0)?deepFreeze({...o,directorCue:cue}):o;};
        const a = observe(0), b = observe(1), intents = [this.controllers[0].update(a), this.controllers[1].update(b)] as const;
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
        if(out.state.result)this.director?.finish(out.state.tick);
        if (out.state.tick % 60 === 0 || out.state.result)
            this.checkpoints.push({ tick: out.state.tick, worldHash: fighterWorldHash(out.state) });
        if (this.options.recordFrames)
            this.frames.push(renderFrame(out.state));
    }
    run(): InputReplay { while (!this.sim.snapshot().result)
        this.step(); return this.replay(); }
    replay(): InputReplay { const result = this.sim.snapshot().result; if (!result || !this.recordingComplete)
        throw new Error('Replay requires completed match and complete input recording'); return deepFreeze({ replaySchemaVersion: 2, engineBuild: this.engineBuild, config: this.config, content: this.content.source, pluginVersions: this.content.pluginVersions, inputs: [...this.inputs], events: [...this.events], checkpoints: [...this.checkpoints], finalWorldHash: fighterWorldHash(this.sim.snapshot()), result,...(this.engineBuild===PHASE3B_BUILD?{directorRecords:this.director?.records??[]}:{} ) }); }
    snapshot(includeRecording = false): FullCheckpoint {
        const controllers = this.controllers.map((c, i) => ({ kind: this.options.kinds[i], data: c.snapshot() })) as unknown as FullCheckpoint['controllers'];
        const future = { checkpointVersion: 1 as const, engineBuild: this.engineBuild, aiVersion: this.aiVersion, contentHash: this.content.bundleHash, config: this.config, nextTick: this.sim.snapshot().tick, world: this.sim.snapshot(), controllers, observations: this.observations.snapshot(), settings: this.options.settings, pacingDirector: this.director?.snapshot()??null, recorderCursor: this.recorderCursor };
        return deepFreeze({ ...future, runnerHash: hashCanonical(future), ...(includeRecording && this.recordingComplete ? { recording: { inputs: [...this.inputs], events: [...this.events], checkpoints: [...this.checkpoints],...(this.engineBuild===PHASE3B_BUILD?{directorRecords:[...(this.director?.records??[])]}:{} ) } } : {}) });
    }
    runnerHash(): string { return this.snapshot().runnerHash; }
    restore(input: unknown): void {
        const cp = FullCheckpointSchema.parse(input), { runnerHash, recording, ...future } = cp;
        if (hashCanonical(future) !== runnerHash)
            throw new Error('Checkpoint runnerHash mismatch');
        if (cp.engineBuild!==this.engineBuild||cp.aiVersion!==this.aiVersion||cp.contentHash !== this.content.bundleHash || canonicalSerialize(cp.config) !== canonicalSerialize(this.config) || canonicalSerialize(cp.settings) !== canonicalSerialize(this.options.settings) || cp.nextTick !== cp.world.tick || cp.recorderCursor !== cp.nextTick)
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
        if(Boolean(cp.pacingDirector)!==Boolean(this.director))throw new Error('Checkpoint pacing mode mismatch');
        if(cp.pacingDirector&&this.director){if(cp.pacingDirector.nextUpdateTick<cp.nextTick||cp.pacingDirector.nextUpdateTick>=cp.nextTick+this.director.profile.sampleIntervalTicks||cp.pacingDirector.lastConsumedSnapshotTick!==null&&cp.pacingDirector.lastConsumedSnapshotTick>cp.nextTick-this.directorDelayTicks)throw new Error('Checkpoint director time mismatch');this.director.restore(cp.pacingDirector);}
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
            if(this.director&&recording.directorRecords)this.director.records.push(...recording.directorRecords as DirectorRecord[]);
        }
        else if (cp.nextTick === 0)
            this.checkpoints.push({ tick: 0, worldHash: fighterWorldHash(cp.world) });
        if (this.options.recordFrames)
            this.frames.push(renderFrame(cp.world));
    }
}
