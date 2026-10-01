import { FIGHTER_BUILD, type InputReplay, type RenderFrame } from '../contracts/fighter.js';
import { FighterConfigSchema, ActionIntentSchema, FighterResultSchema } from '../contracts/fighter-schema.js';
import { ContentSourceSchema } from '../contracts/content-schema.js';
import { compilePhase3AContent } from '../content/phase3a.js';
import { compileFighterContent } from '../content/fighter.js';
import { FighterSimulation } from '../sim/fighter.js';
import { fighterWorldHash } from '../sim/fighter-state.js';
import { canonicalSerialize } from '../math/canonical.js';
import { renderFrame } from '../replay/frame.js';
export function replayInputs(input: unknown, recordFrames = true): {
    replay: InputReplay;
    frames: RenderFrame[];
} {
    if (!input || typeof input !== 'object')
        throw new Error('Bad replay envelope');
    const r = input as InputReplay;
    if (r.replaySchemaVersion !== 2 || ![FIGHTER_BUILD,'phase2-v1','phase3a-v1'].includes(r.engineBuild))
        throw new Error('Replay schema/build mismatch');
    const config = FighterConfigSchema.parse(r.config), content = (r.engineBuild==='phase3a-v1'?compilePhase3AContent:compileFighterContent)(ContentSourceSchema.parse(r.content));
    FighterResultSchema.parse(r.result);
    if (config.contentHash !== content.bundleHash || canonicalSerialize(r.pluginVersions) !== canonicalSerialize(content.pluginVersions))
        throw new Error('Replay content/plugin mismatch');
    if (!Array.isArray(r.inputs) || r.inputs.length > 3600 || !Array.isArray(r.events) || !Array.isArray(r.checkpoints))
        throw new Error('Bad replay arrays');
    const sim = new FighterSimulation(content, config,undefined,r.engineBuild), frames: RenderFrame[] = [], events = [];
    if (recordFrames)
        frames.push(renderFrame(sim.snapshot()));
    const checks = new Map(r.checkpoints.map(c => [c.tick, c.worldHash]));
    const requiredTicks = [0, ...Array.from({ length: Math.floor(r.inputs.length / 60) }, (_, i) => (i + 1) * 60)];
    if (r.inputs.length % 60 !== 0)
        requiredTicks.push(r.inputs.length);
    if (checks.size !== r.checkpoints.length || canonicalSerialize(r.checkpoints.map(c => c.tick)) !== canonicalSerialize(requiredTicks))
        throw new Error('Replay checkpoint sequence mismatch');
    if (checks.get(0) !== fighterWorldHash(sim.snapshot()))
        throw new Error('Replay initial hash mismatch');
    for (const entry of r.inputs) {
        if (entry.tick !== sim.snapshot().tick || sim.snapshot().result || entry.intents.length !== 2)
            throw new Error('Replay input tick discontinuity');
        const intents = entry.intents.map((i: unknown) => ActionIntentSchema.parse(i)) as unknown as InputReplay['inputs'][number]['intents'];
        const out = sim.step(intents);
        events.push(...out.events);
        if (checks.has(out.state.tick) && checks.get(out.state.tick) !== fighterWorldHash(out.state))
            throw new Error(`Replay checkpoint mismatch at ${out.state.tick}`);
        if (recordFrames)
            frames.push(renderFrame(out.state));
    }
    if (!sim.snapshot().result || fighterWorldHash(sim.snapshot()) !== r.finalWorldHash || canonicalSerialize(events) !== canonicalSerialize(r.events) || canonicalSerialize(sim.snapshot().result) !== canonicalSerialize(r.result))
        throw new Error('Replay final hash/events/result mismatch');
    return { replay: r, frames };
}
