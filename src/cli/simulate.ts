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
import { gzipSync } from 'node:zlib';
import { compilePhase3BContent, PACING_PROFILE_ID } from '../content/phase3b.js';
import { compilePhase3AContent } from '../content/phase3a.js';
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
            ai: { type: 'string' },build:{type:'string'},ruleset:{type:'string'},pacing:{type:'string',default:'off'},'no-prediction':{type:'boolean'},'no-hysteresis':{type:'boolean'},'no-delay':{type:'boolean'}, 'profile-a': { type: 'string' }, 'profile-b': { type: 'string' }, 'no-noise': { type: 'boolean' }, eval: { type: 'boolean' }, 'no-memory': { type: 'boolean' }, trace: { type: 'string' }, checkpoint: { type: 'string' }, 'checkpoint-at': { type: 'string' }, resume: { type: 'string' },
            content: { type: 'string' }, output: { type: 'string' },
            'record-states': { type: 'boolean', default: false }, help: { type: 'boolean', default: false },
        }, strict: true, allowPositionals: false,
    });
    if (values.help) {
        console.log('Phase 3B: npm run simulate -- --ai utility --a iron --b mirror --seed 17 --trace artifacts/phase-3b/trace.json\nCharacters: standard|rubber|iron|mirror; controllers: utility|rush|ranged|idle; pacing: off|observe|pace (default off)\nCheckpoint: add --checkpoint-at 240 --checkpoint artifacts/phase-3b/checkpoint.json; resume with --resume FILE\nProfiles: --profile-a/--profile-b balanced|pressure|counter|evasive; diagnostic flags --no-noise --eval --no-memory --no-prediction --no-hysteresis\nLegacy Phase 2: --ai utility --build phase2-v1; Phase 1: --a standard --b rubber --controller-a rush --controller-b ranged\nReplay: --replay FILE; zero-gravity diagnostic: --ai utility --a standard --b standard --ruleset free-bounce-fixture\nPhase 0 fixture: --seed 17 --ticks 600 [--record-states]; full evaluation: npm run evaluate:ai -- --ablations');
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
    if(values.build!==undefined&&!['phase2-v1','phase3a-v1','phase3b-v1'].includes(values.build))throw new Error('--build must be phase2-v1|phase3a-v1|phase3b-v1');
    if(!['off','observe','pace'].includes(values.pacing))throw new Error('--pacing must be off|observe|pace');
    if(values.ruleset!==undefined&&!['fighter','free-bounce-fixture'].includes(values.ruleset))throw new Error('--ruleset must be fighter|free-bounce-fixture');
    if (values.ai !== undefined && values.ai !== 'utility')
        throw new Error('--ai must be utility');
    if (values.ai === 'utility' || values['controller-a'] === 'utility' || values['controller-b'] === 'utility' || values.resume || values.build==='phase3a-v1' || values.build==='phase3b-v1' || values.pacing!=='off' || ['iron','mirror'].includes(values.a??'') || ['iron','mirror'].includes(values.b??'') || values.ruleset==='free-bounce-fixture') {
        const saved = values.resume ? JSON.parse(await readFile(resolve(values.resume), 'utf8')) as {
            content: unknown;
            checkpoint: FullCheckpoint;
        } : null;
        const pacingExplicit=process.argv.slice(2).some(arg=>arg==='--pacing'||arg.startsWith('--pacing='));
        if(saved&&pacingExplicit&&values.pacing!==saved.checkpoint.config.pacing.mode)throw new Error('Resume keeps the saved pacing mode; start a new simulation to change modes');
        if(saved&&values.build!==undefined&&values.build!==saved.checkpoint.engineBuild)throw new Error('Resume keeps the saved engine build');
        const build=values.build??saved?.checkpoint.engineBuild??'phase3b-v1';
        const path=values.content?resolve(values.content):fileURLToPath(new URL(`../../../content/fighter-${build==='phase2-v1'?'phase2':build==='phase3a-v1'?'phase3a':'phase3b'}.json`,import.meta.url));
        const raw=saved?.content??JSON.parse(await readFile(path,'utf8'));
        if(values.ruleset==='free-bounce-fixture'){const arena=structuredClone(raw.arenas[0]);arena.id='free-bounce-test';arena.gravity={x:0,y:0};arena.spawnPositions=[{x:240,y:260},{x:720,y:600}];raw.arenas.push(arena);}
        const bundle=(build==='phase2-v1'?compileUtilityContent:build==='phase3a-v1'?compilePhase3AContent:compilePhase3BContent)(raw),ticks=integer('ticks',values.ticks??(values.ruleset==='free-bounce-fixture'?'600':'3600'),3600,1);
        const config = saved?.checkpoint.config ?? fighterConfig(bundle, seed, values.a ?? 'standard', values.b ?? 'rubber', ticks);
        if(!saved)config.pacing={mode:values.pacing as 'off'|'observe'|'pace',profileId:values.pacing==='off'?null:PACING_PROFILE_ID};
        if(values.ruleset==='free-bounce-fixture'){config.rulesetId='free-bounce-fixture';config.arenaId='free-bounce-test';}
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
        const settings = saved?.checkpoint.settings ?? { noise: !values['no-noise'], randomChoice: !values.eval, memory: !values['no-memory'], ...(values['no-prediction']?{prediction:false}:{}),...(values['no-hysteresis']?{hysteresis:false}:{}) };
        if(values['no-delay'])throw new Error('Use evaluate:ai --ablations for the controlled no-delay research experiment');
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
        const replay = runner.replay(), destination = resolve(values.output ?? `artifacts/${build==='phase2-v1'?'phase-2':build==='phase3a-v1'?'phase-3a':'phase-3b'}/replays/${config.matchId}.json`);
        await save(destination, replay);
        if(build==='phase3b-v1')await writeFile(destination+'.director.ndjson.gz',gzipSync((replay.directorRecords??[]).map(r=>canonicalSerialize(r)).join('\n')+'\n'));
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
