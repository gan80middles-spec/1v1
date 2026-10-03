import assert from 'node:assert/strict';
import {readFile, writeFile, mkdir, appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {pacingMetrics} from '../dist/node/analysis/pacing-metrics.js';
import {aggregateEvaluation, evaluationMetrics} from '../dist/node/analysis/evaluation.js';
import {canonicalSerialize} from '../dist/node/math/canonical.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {argumentsFor, fingerprint, loadManifest, caseConfig, summarize} from './optimization-common.mjs';

const args = argumentsFor(['--content','--version','--manifest','--split','--output','--limit','--trace','--freeze'], {'--split':'train','--limit':'0'});
for (const key of ['--content','--version','--manifest','--output']) assert(args[key], `Required ${key}`);
assert(['train','holdout','all'].includes(args['--split']));
const limit = Number(args['--limit']); assert(Number.isInteger(limit) && limit >= 0);
const content = compilePhase3BContent(JSON.parse(await readFile(args['--content'], 'utf8')));
const manifest = await loadManifest(args['--manifest']), source = await fingerprint();
let cases = manifest.cases.filter(c => args['--split'] === 'all' || c.split === args['--split']);
if (limit) cases = cases.filter(c => c.sampleIndex < limit);
assert(cases.length);
if (cases.some(c => c.split === 'holdout') && manifest.datasetId.startsWith('optimization-')) {
  assert(args['--freeze'], 'New holdout requires a frozen experiment');
  const freeze = JSON.parse(await readFile(args['--freeze'], 'utf8'));
  assert.equal(freeze.sourceHash, source.hash, 'Source/build freeze drift');
  assert.equal(freeze.manifestHash, manifest.datasetHash);
  assert(freeze.contents.some(c => c.hash === content.bundleHash && c.version === args['--version']), 'Unfrozen candidate');
  assert(freeze.criteria && freeze.decision, 'Missing adoption criteria');
}
const directory = resolve(args['--output']); await mkdir(directory, {recursive:true});
await writeFile(resolve(directory, 'experiment.json'), JSON.stringify({args, manifestHash:manifest.datasetHash,
  contentHash:content.bundleHash, sourceHash:source.hash, node:process.version, cases:cases.length,
  metricsVersion:'pacing-v1', diagnosticDefinition:'predicted credit / nominal damage is a ratio, not probability; actual labels only for accepted casts.'},null,2)+'\n',{flag:'wx'});
await writeFile(resolve(directory,'source-hashes.json'),JSON.stringify(source,null,2)+'\n');
await writeFile(resolve(directory,'content.json'),JSON.stringify(content.source,null,2)+'\n');
await mkdir(resolve(directory,'records')); await mkdir(resolve(directory,'failures'));
const rows = [], diagnostic = [], started = performance.now();
for (const item of cases) {
  let runner;
  try {
    const config = caseConfig(content,item), kinds = item.baseline ? item.side === 0 ? ['utility',item.baseline] : [item.baseline,'utility'] : ['utility','utility'];
    runner = new UtilityRunner(content,config,{kinds,recordFrames:true,trace:Boolean(args['--trace'])});
    assert.equal(runner.aiVersion,args['--version'],'Declared AI differs from actual runner');
    const replay = runner.run(); assert.notEqual(replay.result.reason,'invalid');
    const pacing = pacingMetrics(replay,runner.frames);
    const row = {...item, pacing, winner:replay.result.winnerParticipantId,
      inputHash:hashCanonical(replay.inputs), worldHash:replay.finalWorldHash, runnerHash:runner.runnerHash()};
    if(item.baseline) row.metrics = evaluationMetrics(replay,runner.frames,item.side+1);
    rows.push(row);
    await writeFile(resolve(directory,'records',item.caseId+'.json.gz'),gzipSync(canonicalSerialize(replay)+'\n'));
    if (args['--trace']) {
      const traceByRequest = new Map(runner.traces.map(({entityId,trace}) => [`${entityId}:${trace.requestId}`,trace]));
      const damageByCast = new Map();
      for (const event of replay.events) if (event.type === 'DamageResolved') {
        const key = `${event.sourceId}:${event.payload.castId}`;
        damageByCast.set(key,(damageByCast.get(key)??0)+event.payload.amount);
      }
      for (const event of replay.events.filter(e => e.type === 'CastAccepted' && e.payload.slot === 'basic')) {
        const trace = traceByRequest.get(`${event.sourceId}:${event.payload.requestId}`);
        if (!trace) continue;
        const selected = trace.candidates.find(c => c.option.key === trace.selectedKey), ability = content.source.abilities.find(a=>a.id===event.payload.abilityId);
        const interruption = replay.events.find(e=>e.type==='CastInterrupted' && e.payload.castId===event.payload.castId);
        const nominal = ability.timeline.flatMap(t=>t.effects).filter(f=>f.kind==='hitbox'||f.kind==='projectile').reduce((s,f)=>s+f.hit.damage,0);
        const enemyChar = item[event.sourceId===1?'b':'a'], enemyMax = content.source.characters.find(c=>c.id===enemyChar).stats.maxHp;
        diagnostic.push({caseId:item.caseId,actorId:event.sourceId,character:item[event.sourceId===1?'a':'b'],tick:event.tick,castId:event.payload.castId,
          abilityId:ability.id,actualDamage:damageByCast.get(`${event.sourceId}:${event.payload.castId}`)??0,
          interruption:interruption?interruption.tick<event.tick+ability.startupTicks?'before-active':'during-or-after-active':'none',
          predictedCreditRatio:(selected?.outcome?.castDamageDealtPct??0)*enemyMax/100/nominal,
          selected,belief:trace.belief,actualAtDecision:runner.frames[event.tick]?.entities??null});
      }
    }
  } catch (error) {
    const failure = {...item,error:{message:error.message,stack:error.stack},tick:runner?.sim.snapshot().tick??null,
      checkpoint:runner?.snapshot(true)??null,trace:runner?.traces??null,content:content.source};
    await writeFile(resolve(directory,'failures',item.caseId+'.json.gz'),gzipSync(canonicalSerialize(failure)+'\n'));
    rows.push({...item,error:failure.error}); process.exitCode = 1;
  }
  await appendFile(resolve(directory,'cases.ndjson'),JSON.stringify(rows.at(-1))+'\n');
  if(rows.length%20===0) console.log(`${directory.split(/[\\/]/).at(-1)}: ${rows.length}/${cases.length}`);
}
const report = {passed:!rows.some(r=>r.error),args,manifestHash:manifest.datasetHash,contentHash:content.bundleHash,sourceHash:source.hash,
  actualAiVersion:args['--version'],elapsedSeconds:(performance.now()-started)/1000,summary:summarize(rows),
  baseline:rows.some(r=>r.metrics)?aggregateEvaluation(rows.filter(r=>r.metrics)):null,rows};
await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');
if(args['--trace'])await writeFile(resolve(directory,'basic-diagnostics.json.gz'),gzipSync(JSON.stringify(diagnostic)+'\n'));
console.log(JSON.stringify({...report,rows:undefined}));
