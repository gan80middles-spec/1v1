import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { compileContent } from '../content/compile.js';
import { createNeutralConfig, runNeutralMatch } from '../runner/neutral.js';
import { canonicalSerialize } from '../math/canonical.js';

async function main(): Promise<void> {
  if (process.version !== 'v24.21.0') throw new Error('Authoritative simulation requires Node 24.21.0; run . ./scripts/use-node.ps1 first.');
  const { values } = parseArgs({
    options: {
      seed: { type: 'string',default: '17' }, ticks: { type: 'string',default: '600' },
      content: { type: 'string' }, output: { type: 'string' },
      'record-states': { type: 'boolean',default: false }, help: { type: 'boolean',default: false },
    }, strict: true, allowPositionals: false,
  });
  if (values.help) {
    console.log('Phase 0 neutral fixture (no combat)\n  npm run simulate -- --seed 17 --ticks 600 [--content FILE] [--output FILE] [--record-states]\n  seed: uint32; ticks: integer 1..3600; output: UTF-8 JSON, parent folders created.');
    return;
  }
  const integer = (name: string,text: string,max: number,min = 0): number => {
    if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < min || Number(text) > max) throw new Error(`--${name} must be an integer in [${min},${max}]`);
    return Number(text);
  };
  const seed = integer('seed',values.seed,0xffffffff);
  const ticks = integer('ticks',values.ticks,3600,1);
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
