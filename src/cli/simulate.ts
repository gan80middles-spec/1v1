import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compileContent } from '../content/compile.js';
import { createNeutralConfig, runNeutralMatch } from '../runner/neutral.js';
import { canonicalSerialize } from '../math/canonical.js';
import {compileFighterContent} from '../content/fighter.js';
import {FighterRunner,fighterConfig} from '../runner/fighter.js';
import {replayInputs} from '../runner/input-replay.js';

async function main(): Promise<void> {
  if (process.version !== 'v24.21.0') throw new Error('Authoritative simulation requires Node 24.21.0; run . ./scripts/use-node.ps1 first.');
  const { values } = parseArgs({
    options: {
      seed: { type: 'string',default: '17' }, ticks: { type: 'string' },
      a:{type:'string'},b:{type:'string'},'controller-a':{type:'string',default:'rush'},'controller-b':{type:'string',default:'ranged'},replay:{type:'string'},
      content: { type: 'string' }, output: { type: 'string' },
      'record-states': { type: 'boolean',default: false }, help: { type: 'boolean',default: false },
    }, strict: true, allowPositionals: false,
  });
  if (values.help) {
    console.log('Fighter: npm run simulate -- --a standard --b rubber --seed 17 --output artifacts/match.json\nReplay: npm run simulate -- --replay artifacts/match.json\nPhase 0 fixture: npm run simulate -- --seed 17 --ticks 600 [--record-states]\nOptions: --ticks 1..3600, --content FILE, --controller-a/--controller-b rush|ranged|idle');
    return;
  }
  const integer = (name: string,text: string,max: number,min = 0): number => {
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < min || Number(text) > max) throw new Error(`--${name} must be an integer in [${min},${max}]`);
    return Number(text);
  };
  const seed = integer('seed',values.seed,0xffffffff);
  if(values.replay){const checked=replayInputs(JSON.parse(await readFile(resolve(values.replay),'utf8')) as unknown,false);console.log(JSON.stringify({replayVerified:true,finalWorldHash:checked.replay.finalWorldHash,result:checked.replay.result},null,2));return;}
  const isFighter=values.a!==undefined||values.b!==undefined;
  const ticks = integer('ticks',values.ticks??(isFighter?'3600':'600'),3600,1);
  if(isFighter){
    const kinds=[values['controller-a'],values['controller-b']] as const;if(kinds.some(k=>!['rush','ranged','idle'].includes(k)))throw new Error('controller must be rush|ranged|idle');
    const path=values.content?resolve(values.content):fileURLToPath(new URL('../../../content/fighter-phase1.json',import.meta.url));
    const bundle=compileFighterContent(JSON.parse(await readFile(path,'utf8')) as unknown);
    const runner=new FighterRunner(bundle,fighterConfig(bundle,seed,values.a??'standard',values.b??'rubber',ticks),kinds as ['rush'|'ranged'|'idle','rush'|'ranged'|'idle'],false);
    const replay=runner.run();
    const destination=resolve(values.output??`artifacts/phase-1/replays/${replay.config.matchId}.json`);await mkdir(dirname(destination),{recursive:true});const temporary=`${destination}.${process.pid}.tmp`;await writeFile(temporary,canonicalSerialize(replay)+'\n','utf8');await rename(temporary,destination);
    if(replay.result.reason==='invalid'){await writeFile(destination+'.failure.json',canonicalSerialize({engineBuild:replay.engineBuild,config:replay.config,content:replay.content,state:runner.sim.snapshot(),inputs:replay.inputs,events:replay.events})+'\n');process.exitCode=2;}
    console.log(JSON.stringify({engineBuild:replay.engineBuild,seed,executedTicks:replay.inputs.length,finalWorldHash:replay.finalWorldHash,result:replay.result,output:destination},null,2));return;
  }
  const contentPath = values.content ? resolve(values.content) : fileURLToPath(new URL('../../../content/fixtures/phase0.json',import.meta.url));
  const content = compileContent(JSON.parse(await readFile(contentPath,'utf8')) as unknown);
  const report = runNeutralMatch(content,createNeutralConfig(content,seed,ticks),values['record-states']);
  if (values.output) {
    const output = resolve(values.output);
    await mkdir(dirname(output),{ recursive: true });
    const temporary = `${output}.${process.pid}.tmp`;
    await writeFile(temporary,`${canonicalSerialize(report)}\n`,'utf8');
    await rename(temporary,output);
  }
  console.log(JSON.stringify({
    fixture: report.fixture, seed, ticks: report.executedTicks, stateCount: report.stateCount,
    contentHash: report.contentHash, stateSequenceHash: report.stateSequenceHash,
    finalWorldHash: report.finalWorldHash, result: report.result,
    output: values.output ? resolve(values.output) : null,
  },null,2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
