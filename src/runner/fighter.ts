import type { ContentBundle } from '../contracts/content.js';
import { FIGHTER_BUILD, type BattleEvent, type ControllerKind, type FighterConfig, type InputEntry, type InputReplay, type RenderFrame } from '../contracts/fighter.js';
import { deriveParticipantSeed } from '../math/random.js';
import { deepFreeze } from '../math/canonical.js';
import { fighterWorldHash } from '../sim/fighter-state.js';
import { FighterSimulation } from '../sim/fighter.js';
import { BaselineController } from '../ai/scripted.js';
import { ObservationBuffer } from './observation.js';
import { renderFrame } from '../replay/frame.js';
export function fighterConfig(content: ContentBundle, seed = 17, a = 'standard', b = 'rubber', maxTicks = 3600): FighterConfig {
    const participant = (id: string, characterId: string) => {
        const c = content.source.characters.find(c => c.id === characterId);
        if (!c)
            throw new Error(`Unknown character ${characterId}`);
        return { participantId: id, characterId, profileId: c.aiProfileId };
    };
    return { matchId: `${a}-vs-${b}-${seed}`, seed, rulesetId: 'fighter', rulesetVersion: 1, arenaId: content.source.arenas[0]!.id, contentHash: content.bundleHash, pacing: { mode: 'off', profileId: null }, participants: [participant('A', a), participant('B', b)], maxTicks };
}
export class FighterRunner {
    readonly sim: FighterSimulation;
    readonly controllers: readonly [
        BaselineController,
        BaselineController
    ];
    readonly observations: ObservationBuffer;
    readonly inputs: InputEntry[] = [];
    readonly events: BattleEvent[] = [];
    readonly checkpoints: {
        tick: number;
        worldHash: string;
    }[] = [];
    readonly frames: RenderFrame[] = [];
    constructor(readonly content: ContentBundle, readonly config: FighterConfig, kinds: readonly [
        ControllerKind,
        ControllerKind
    ] = ['rush', 'ranged'], private recordFrames = true) {
        this.sim = new FighterSimulation(content, config);
        this.controllers = [new BaselineController(kinds[0], deriveParticipantSeed(config.seed, config.participants[0].participantId), content), new BaselineController(kinds[1], deriveParticipantSeed(config.seed, config.participants[1].participantId), content)];
        this.observations = new ObservationBuffer(content);
        this.observations.push(this.sim.snapshot(), [], []);
        this.checkpoints.push({ tick: 0, worldHash: fighterWorldHash(this.sim.snapshot()) });
        if (recordFrames)
            this.frames.push(renderFrame(this.sim.snapshot()));
    }
    step(): void {
        const w = this.sim.snapshot();
        const a = this.observations.observe(w, 0), b = this.observations.observe(w, 1);
        const intents = [this.controllers[0].update(a), this.controllers[1].update(b)] as const;
        this.inputs.push({ tick: w.tick, intents });
        const out = this.sim.step(intents);
        this.events.push(...out.events);
        this.observations.push(out.state, out.events, out.receipts);
        if (out.state.tick % 60 === 0 || out.state.result)
            this.checkpoints.push({ tick: out.state.tick, worldHash: fighterWorldHash(out.state) });
        if (this.recordFrames)
            this.frames.push(renderFrame(out.state));
    }
    run(): InputReplay {
        while (!this.sim.snapshot().result)
            this.step();
        return this.replay();
    }
    replay(): InputReplay {
        const result = this.sim.snapshot().result;
        if (!result)
            throw new Error('Replay requires completed match');
        return deepFreeze({ replaySchemaVersion: 2, engineBuild: FIGHTER_BUILD, config: this.config, content: this.content.source, pluginVersions: this.content.pluginVersions, inputs: [...this.inputs], events: [...this.events], checkpoints: [...this.checkpoints], finalWorldHash: fighterWorldHash(this.sim.snapshot()), result });
    }
}
