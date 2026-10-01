import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compileContent } from '../content/compile.js';
import { createNeutralConfig, runNeutralMatch } from '../runner/neutral.js';
import { canonicalSerialize } from '../math/canonical.js';
import { compileFighterContent } from '../content/fighter.js';
import { FighterRunner, fighterConfig } from '../runner/fighter.js';
import { replayInputs } from '../runner/input-replay.js';
import { compileUtilityContent } from '../content/utility.js';
import { UtilityRunner } from '../runner/utility.js';
import type { FullCheckpoint, RunnerControllerKind } from '../contracts/ai.js';
async function main(): Promise<void> {
    if (process.version !== 'v24.21.0')
        throw new Error('Authoritative simulation requires Node 24.21.0; run . ./scripts/use-node.ps1 first.');
    const { values } = parseArgs({
        options: {
            seed: { type: 'string', default: '17' }, ticks: { type: 'string' },
            a: { type: 'string' }, b: { type: 'string' }, 'controller-a': { type: 'string' }, 'controller-b': { type: 'string' }, replay: { type: 'string' },
            ai: { type: 'string' }, 'profile-a': { type: 'string' }, 'profile-b': { type: 'string' }, 'no-noise': { type: 'boolean' }, eval: { type: 'boolean' }, 'no-memory': { type: 'boolean' }, trace: { type: 'string' }, checkpoint: { type: 'string' }, 'checkpoint-at': { type: 'string' }, resume: { type: 'string' },
            content: { type: 'string' }, output: { type: 'string' },
            'record-states': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
        }, strict: true, allowPositionals: false,
    });
    if (values.help) {
        console.log('Utility: npm run simulate -- --ai utility --a standard --b rubber --seed 17 --trace artifacts/phase-2/trace.json\nCheckpoint: add --checkpoint-at 240 --checkpoint artifacts/phase-2/checkpoint.json; resume with --resume FILE\nProfiles: --profile-a/--profile-b balanced|pressure|counter|evasive; diagnostic flags --no-noise --eval --no-memory\nPhase 1: --a standard --b rubber --controller-a rush --controller-b ranged\nReplay: --replay FILE; Phase 0 fixture: --seed 17 --ticks 600 [--record-states]');
        return;
    }
    const integer = (name: string, text: string, max: number, min = 0): number => {
        if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < min || Number(text) > max)
            throw new Error(`--${name} must be an integer in [${min},${max}]`);
        return Number(text);
    };
    const seed = integer('seed', values.seed, 0xffffffff);
    if (values.replay) {
        const checked = replayInputs(JSON.parse(await readFile(resolve(values.replay), 'utf8')) as unknown, false);
        console.log(JSON.stringify({ replayVerified: true, finalWorldHash: checked.replay.finalWorldHash, result: checked.replay.result }, null, 2));
        return;
    }
    if (values.ai !== undefined && values.ai !== 'utility')
        throw new Error('--ai must be utility');
    if (values.ai === 'utility' || values['controller-a'] === 'utility' || values['controller-b'] === 'utility' || values.resume) {
        const saved = values.resume ? JSON.parse(await readFile(resolve(values.resume), 'utf8')) as {
            content: unknown;
            checkpoint: FullCheckpoint;
        } : null;
        const path = values.content ? resolve(values.content) : fileURLToPath(new URL('../../../content/fighter-phase2.json', import.meta.url));
        const bundle = compileUtilityContent(saved?.content ?? JSON.parse(await readFile(path, 'utf8')) as unknown), ticks = integer('ticks', values.ticks ?? '3600', 3600, 1);
        const config = saved?.checkpoint.config ?? fighterConfig(bundle, seed, values.a ?? 'standard', values.b ?? 'rubber', ticks);
        for (const i of [0, 1] as const) {
            const id = values[i === 0 ? 'profile-a' : 'profile-b'];
            if (id) {
                if (!bundle.source.profiles.some(p => p.id === id))
                    throw new Error(`Unknown profile ${id}`);
                config.participants[i].profileId = id;
            }
        }
        const kinds = saved?.checkpoint.controllers.map(c => c.kind) ?? [values['controller-a'] ?? 'utility', values['controller-b'] ?? 'utility'];
        if (kinds.some(k => !['utility', 'rush', 'ranged', 'idle'].includes(k)))
            throw new Error('controller must be utility|rush|ranged|idle');
        const settings = saved?.checkpoint.settings ?? { noise: !values['no-noise'], randomChoice: !values.eval, memory: !values['no-memory'] };
        const runner = new UtilityRunner(bundle, config, { kinds: kinds as [
                RunnerControllerKind,
                RunnerControllerKind
            ], settings, trace: Boolean(values.trace), recordFrames: false });
        if (saved)
            runner.restore(saved.checkpoint);
        const save = async (path: string, data: unknown): Promise<void> => { const destination = resolve(path); await mkdir(dirname(destination), { recursive: true }); const temporary = `${destination}.${process.pid}.tmp`; await writeFile(temporary, canonicalSerialize(data) + '\n', 'utf8'); await rename(temporary, destination); };
        if (Boolean(values.checkpoint) !== Boolean(values['checkpoint-at']))
            throw new Error('--checkpoint and --checkpoint-at must be used together');
        const checkpointAt = values['checkpoint-at'] ? integer('checkpoint-at', values['checkpoint-at'], config.maxTicks) : null;
        let checkpointSaved = false;
        while (true) {
            if (checkpointAt === runner.sim.snapshot().tick) {
                await save(values.checkpoint!, { content: bundle.source, checkpoint: runner.snapshot(true) });
                checkpointSaved = true;
            }
            if (runner.sim.snapshot().result)
                break;
            runner.step();
        }
        if (checkpointAt !== null && !checkpointSaved)
            throw new Error('Match ended before requested checkpoint tick');
        const replay = runner.replay(), destination = resolve(values.output ?? `artifacts/phase-2/replays/${config.matchId}.json`);
        await save(destination, replay);
        if (values.trace)
            await save(values.trace, { engineBuild: replay.engineBuild, config, contentHash: bundle.bundleHash, traces: runner.traces, finalControllers: runner.controllers.map(c => c.snapshot()) });
        if (replay.result.reason === 'invalid') {
            await save(destination + '.failure.json', { content: bundle.source, checkpoint: runner.snapshot(true), trace: runner.traces });
            process.exitCode = 2;
        }
        console.log(JSON.stringify({ engineBuild: replay.engineBuild, seed: config.seed, executedTicks: replay.inputs.length, finalWorldHash: replay.finalWorldHash, runnerHash: runner.runnerHash(), result: replay.result, output: destination, trace: values.trace ?? null, checkpoint: values.checkpoint ?? null }, null, 2));
        return;
    }
    const isFighter = values.a !== undefined || values.b !== undefined;
    const ticks = integer('ticks', values.ticks ?? (isFighter ? '3600' : '600'), 3600, 1);
    if (isFighter) {
        const kinds = [values['controller-a'] ?? 'rush', values['controller-b'] ?? 'ranged'] as const;
        if (kinds.some(k => !['rush', 'ranged', 'idle'].includes(k)))
            throw new Error('controller must be rush|ranged|idle');
        const path = values.content ? resolve(values.content) : fileURLToPath(new URL('../../../content/fighter-phase1.json', import.meta.url));
        const bundle = compileFighterContent(JSON.parse(await readFile(path, 'utf8')) as unknown);
        const runner = new FighterRunner(bundle, fighterConfig(bundle, seed, values.a ?? 'standard', values.b ?? 'rubber', ticks), kinds as [
            'rush' | 'ranged' | 'idle',
            'rush' | 'ranged' | 'idle'
        ], false);
        const replay = runner.run();
        const destination = resolve(values.output ?? `artifacts/phase-1/replays/${replay.config.matchId}.json`);
        await mkdir(dirname(destination), { recursive: true });
        const temporary = `${destination}.${process.pid}.tmp`;
        await writeFile(temporary, canonicalSerialize(replay) + '\n', 'utf8');
        await rename(temporary, destination);
        if (replay.result.reason === 'invalid') {
            await writeFile(destination + '.failure.json', canonicalSerialize({ engineBuild: replay.engineBuild, config: replay.config, content: replay.content, state: runner.sim.snapshot(), inputs: replay.inputs, events: replay.events }) + '\n');
            process.exitCode = 2;
        }
        console.log(JSON.stringify({ engineBuild: replay.engineBuild, seed, executedTicks: replay.inputs.length, finalWorldHash: replay.finalWorldHash, result: replay.result, output: destination }, null, 2));
        return;
    }
    const contentPath = values.content ? resolve(values.content) : fileURLToPath(new URL('../../../content/fixtures/phase0.json', import.meta.url));
    const content = compileContent(JSON.parse(await readFile(contentPath, 'utf8')) as unknown);
    const report = runNeutralMatch(content, createNeutralConfig(content, seed, ticks), values['record-states']);
    if (values.output) {
        const output = resolve(values.output);
        await mkdir(dirname(output), { recursive: true });
        const temporary = `${output}.${process.pid}.tmp`;
        await writeFile(temporary, `${canonicalSerialize(report)}\n`, 'utf8');
        await rename(temporary, output);
    }
    console.log(JSON.stringify({
        fixture: report.fixture, seed, ticks: report.executedTicks, stateCount: report.stateCount,
        contentHash: report.contentHash, stateSequenceHash: report.stateSequenceHash,
        finalWorldHash: report.finalWorldHash, result: report.result,
        output: values.output ? resolve(values.output) : null,
    }, null, 2));
}
main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
});
