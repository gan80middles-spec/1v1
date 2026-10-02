import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {cpus,release,totalmem} from 'node:os';
import {Worker,isMainThread,parentPort} from 'node:worker_threads';
import {gzipSync} from 'node:zlib';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {FighterSimulation} from '../dist/node/sim/fighter.js';
import {fighterWorldHash} from '../dist/node/sim/fighter-state.js';
import {presentationFrame} from '../dist/node/runner/presentation-recording.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {canonicalSerialize} from '../dist/node/math/canonical.js';
const option=name=>{const i=process.argv.indexOf(name);return i<0?undefined:process.argv[i+1];};
const manifestPath=option('--manifest')??'fixtures/seeds/performance-v1.json';
const manifest=JSON.parse(await readFile(manifestPath,'utf8')),{datasetHash,...manifestBody}=manifest;
assert.equal(hashCanonical(manifestBody),datasetHash);assert.equal(manifest.cases.length,110);assert.equal(manifest.fixedTicks,2700);
const source=JSON.parse(await readFile('content/fighter-phase3b.json','utf8')),production=compilePhase3BContent(source);
// A separate frozen benchmark content snapshot prevents early KO without changing production.
for(const c of source.characters)c.stats.maxHp=1000;
const content=compilePhase3BContent(source);
const config=item=>fighterConfig(content,item.seed,item.a,item.b,2700),warm=manifest.cases.slice(0,10),cases=manifest.cases.slice(10),directory=resolve('artifacts/phase-5/benchmark');
function execute(item,mode,{instrument=false,record=false,trace=false}={}){
  const cfg=config(item);cfg.pacing={mode,profileId:mode==='off'?null:'gentle-v1'};
  const runner=new UtilityRunner(content,cfg,{trace,recordFrames:false}),times={aiMs:0,observationMs:0,directorMs:0},decisions=[];
  if(instrument){for(const controller of runner.controllers){const update=controller.update.bind(controller);controller.update=o=>{const before=controller.decisionsMade,start=performance.now(),input=update(o),elapsed=performance.now()-start;times.aiMs+=elapsed;if(before!==controller.decisionsMade)decisions.push(elapsed);return input;};}
    for(const name of ['push','observe','maturedSince']){const method=runner.observations[name].bind(runner.observations);runner.observations[name]=(...args)=>{const start=performance.now(),out=method(...args);times.observationMs+=performance.now()-start;return out;};}
    if(runner.director){const update=runner.director.update.bind(runner.director);runner.director.update=(...args)=>{const start=performance.now(),out=update(...args);times.directorMs+=performance.now()-start;return out;};}}
  const frames=record?[presentationFrame(runner.sim.snapshot(),content)]:[],checkpoints=[];let peakRss=process.memoryUsage().rss;
  const start=performance.now();while(!runner.sim.snapshot().result){runner.step();if(record){frames.push(presentationFrame(runner.sim.snapshot(),content));if(runner.sim.snapshot().tick%120===0)checkpoints.push(runner.snapshot());}if(runner.sim.snapshot().tick%60===0)peakRss=Math.max(peakRss,process.memoryUsage().rss);}
  const elapsedMs=performance.now()-start,replay=runner.replay();assert.equal(replay.inputs.length,2700,'No early termination '+item.caseId);assert.equal(replay.result.reason,'timeout');
  return {row:{caseId:item.caseId,seed:item.seed,mode,trace,record,ticks:2700,elapsedMs,peakRss,...times,decisionSamples:decisions.length,decisionP95Ms:quantile(decisions,.95),inputHash:hashCanonical(replay.inputs),finalWorldHash:replay.finalWorldHash},replay,frames,checkpoints};
}
function quantile(values,q){const v=[...values].sort((a,b)=>a-b);return v[Math.max(0,Math.ceil(v.length*q)-1)]??null;}
function summarize(rows,wallMs){const elapsedMs=rows.reduce((s,r)=>s+r.elapsedMs,0),ticks=rows.reduce((s,r)=>s+r.ticks,0),sum=k=>rows.reduce((s,r)=>s+(r[k]??0),0);return {cases:rows.length,ticks,simulatedSeconds:ticks/60,wallSeconds:(wallMs??elapsedMs)/1000,realtimeMultiple:ticks/60/((wallMs??elapsedMs)/1000),medianMs:quantile(rows.map(r=>r.elapsedMs),.5),p95Ms:quantile(rows.map(r=>r.elapsedMs),.95),peakRssMiB:Math.max(...rows.map(r=>r.peakRss))/1048576,aiMs:sum('aiMs'),aiFraction:sum('aiMs')/elapsedMs,observationMs:sum('observationMs'),directorMs:sum('directorMs'),directorFraction:sum('directorMs')/elapsedMs};}
if(!isMainThread){for(const item of warm)execute(item,'off');parentPort.postMessage({ready:true});parentPort.on('message',item=>{try{parentPort.postMessage({row:execute(item,'off').row});}catch(error){parentPort.postMessage({error:String(error)});}});}
else{
  assert.equal(process.version,'v24.21.0');await mkdir(directory,{recursive:true});const rows=[],pureRows=[],recordRows=[],traceRows=[];
  for(const item of warm)for(const mode of ['off','observe','pace'])execute(item,mode);
  console.log('Warmed 30 fixed-duration runs');
  for(let i=0;i<cases.length;i++){
    const item=cases[i];let off;
    for(const mode of i%2?['pace','observe','off']:['off','observe','pace']){const result=execute(item,mode,{instrument:true});rows.push(result.row);if(mode==='off')off=result;}
    const observed=rows.find(r=>r.caseId===item.caseId&&r.mode==='observe');assert.equal(observed.inputHash,off.row.inputHash);
    const sim=new FighterSimulation(content,config(item),undefined,'phase3b-v1');let rss=process.memoryUsage().rss;const start=performance.now();for(const input of off.replay.inputs){sim.step(input.intents);if(sim.snapshot().tick%60===0)rss=Math.max(rss,process.memoryUsage().rss);}const elapsedMs=performance.now()-start;
    assert.equal(fighterWorldHash(sim.snapshot()),off.row.finalWorldHash);pureRows.push({caseId:item.caseId,ticks:2700,elapsedMs,peakRss:rss});
    const recorded=execute(item,'off',{record:true});assert.equal(recorded.row.inputHash,off.row.inputHash);const writeStart=performance.now();const bytes=gzipSync(canonicalSerialize({replay:recorded.replay,frames:recorded.frames,checkpoints:recorded.checkpoints}),{level:6});await writeFile(resolve(directory,'last-record.json.gz'),bytes);recordRows.push({...recorded.row,serializationAndIOms:performance.now()-writeStart,compressedBytes:bytes.length});
    if(i<10){const traced=execute(item,'off',{trace:true});assert.equal(traced.row.inputHash,off.row.inputHash);traceRows.push(traced.row);}
    if((i+1)%10===0)console.log(`Fixed-duration benchmark ${i+1}/100 (pure / three modes / recording)`);
  }
  const pool=[],parallel=[];let cursor=0,completed=0;
  await new Promise((accept,reject)=>{for(let i=0;i<4;i++){const worker=new Worker(new URL(import.meta.url));pool.push(worker);worker.on('error',reject);worker.on('exit',code=>{if(code&&completed<100)reject(new Error('Benchmark worker exited '+code));});worker.on('message',message=>{if(message.error){reject(new Error(message.error));return;}if(message.ready){worker.ready=true;if(pool.every(w=>w.ready)){parallel.start=performance.now();for(const w of pool)w.postMessage(cases[cursor++]);}return;}parallel.push(message.row);completed++;if(cursor<cases.length)worker.postMessage(cases[cursor++]);if(completed===100){parallel.elapsedMs=performance.now()-parallel.start;accept();}});}}).finally(()=>Promise.all(pool.map(w=>w.terminate())));
  for(const row of parallel)assert.equal(row.inputHash,rows.find(r=>r.mode==='off'&&r.caseId===row.caseId).inputHash);
  const totals={pure:summarize(pureRows),...Object.fromEntries(['off','observe','pace'].map(mode=>[mode,summarize(rows.filter(r=>r.mode===mode))])),record:summarize(recordRows),trace:summarize(traceRows),fourWorkers:summarize(parallel,parallel.elapsedMs)};
  totals.record.serializationAndIOseconds=recordRows.reduce((s,r)=>s+r.serializationAndIOms,0)/1000;
  const report={passed:true,benchmark:'phase5-fixed-2700-v1',manifestPath,datasetHash,seedList:cases.map(c=>c.seed),warmupCases:10,measuredCases:100,earlyTermination:false,fixedTicks:2700,fixture:{productionContentHash:production.bundleHash,contentHash:content.bundleHash,changes:'maxHp=1000 only in separate benchmark content snapshot; never used for final videos'},machine:{node:process.version,v8:process.versions.v8,cpu:cpus()[0].model,logicalCores:cpus().length,os:process.platform,release:release(),totalMemoryBytes:totalmem()},settings:{inputRecording:true,traceDefault:false,recordIncludes:'presentation every tick and full checkpoint every120; serialization/gzip/write measured separately',parallel:'four permanent warmed workers; pool startup/warmup excluded',rss:'sampled every60ticks; shared process RSS for threads, not summed',instrumentation:'host timings excluded from state; solo three modes include small performance.now wrapper overhead'},totals,targets:{singleWorker20x:totals.off.realtimeMultiple>=20,fourWorkers50x:totals.fourWorkers.realtimeMultiple>=50,aiFractionAtMost60Percent:totals.off.aiFraction<=.6},rows,pureRows,recordRows,traceRows,parallelRows:[...parallel]};
  await writeFile(resolve(directory,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({totals,targets:report.targets},null,2));
}
