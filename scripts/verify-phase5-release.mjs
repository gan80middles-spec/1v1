import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {FighterSimulation} from '../dist/node/sim/fighter.js';
import {fighterWorldHash} from '../dist/node/sim/fighter-state.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {canonicalSerialize} from '../dist/node/math/canonical.js';
import {evaluationMetrics,aggregateEvaluation} from '../dist/node/analysis/evaluation.js';
import {presentationFrame} from '../dist/node/runner/presentation-recording.js';
import {analyzeMatch} from '../dist/node/analysis/interesting.js';
const directory=resolve('artifacts/phase-5/release');await mkdir(resolve(directory,'records'),{recursive:true});await mkdir(resolve(directory,'traces'),{recursive:true});
const source=JSON.parse(await readFile('content/fighter-phase3b.json','utf8')),content=compilePhase3BContent(source),correct=JSON.parse(await readFile('fixtures/seeds/correctness-v1.json','utf8')),baseline=JSON.parse(await readFile('fixtures/seeds/ai-baseline-v1.json','utf8'));
for(const manifest of [correct,baseline]){const {datasetHash,...body}=manifest;assert.equal(hashCanonical(body),datasetHash);}
assert.equal(correct.cases.length,200);assert.equal(baseline.cases.length,800);
const save=async(name,data)=>writeFile(resolve(directory,name),canonicalSerialize(data)+'\n');
const rows=[];let restores=0,comparisons=0;const traceExamples={},traceData=[];
for(const item of correct.cases){
  const cfg=fighterConfig(content,item.seed,item.a,item.b),traced=item.sampleIndex===0;
  const runner=new UtilityRunner(content,cfg,{trace:traced,recordFrames:true}),worlds=[],hashes=[],cps=[];
  while(!runner.sim.snapshot().result){if(traced&&[120,240].includes(runner.sim.snapshot().tick))cps.push(runner.snapshot(true));runner.step();worlds.push(fighterWorldHash(runner.sim.snapshot()));if(runner.sim.snapshot().tick%60===0||runner.sim.snapshot().result)hashes.push({tick:runner.sim.snapshot().tick,hash:runner.runnerHash()});}
  const replay=runner.replay();assert.notEqual(replay.result.reason,'invalid',item.caseId);
  const other=new UtilityRunner(content,cfg,{trace:false,recordFrames:false});let n=0;
  while(!other.sim.snapshot().result){if(traced&&other.sim.snapshot().tick===worlds.length-1)cps.push(other.snapshot(true));other.step();assert.equal(fighterWorldHash(other.sim.snapshot()),worlds[n++],item.caseId+' repeated world');const cp=hashes.find(c=>c.tick===n);if(cp)assert.equal(other.runnerHash(),cp.hash);}
  assert.equal(canonicalSerialize(other.replay()),canonicalSerialize(replay));
  const sim=new FighterSimulation(content,cfg,undefined,'phase3b-v1'),events=[];for(const input of replay.inputs){const out=sim.step(input.intents);assert.equal(fighterWorldHash(out.state),worlds[out.state.tick-1]);events.push(...out.events);}assert.equal(canonicalSerialize(events),canonicalSerialize(replay.events));
  for(const cp of cps){const restored=new UtilityRunner(content,cfg,{recordFrames:false});restored.restore(JSON.parse(JSON.stringify(cp)));while(!restored.sim.snapshot().result){restored.step();const t=restored.sim.snapshot().tick;assert.deepEqual(restored.inputs.at(-1),replay.inputs[t-1]);assert.equal(fighterWorldHash(restored.sim.snapshot()),worlds[t-1]);comparisons++;}assert.equal(restored.runnerHash(),runner.runnerHash());restores++;}
  // Scoring needs the extended saved geometry; regenerate from inputs, never from current AI choices.
  const playback=new FighterSimulation(content,cfg,undefined,'phase3b-v1'),presentation=[presentationFrame(playback.snapshot(),content)];for(const input of replay.inputs){playback.step(input.intents);presentation.push(presentationFrame(playback.snapshot(),content));}
  const analysis=analyzeMatch(replay,presentation),recordFile=`records/${item.caseId}.json.gz`;await writeFile(resolve(directory,recordFile),gzipSync(canonicalSerialize(replay)+'\n'));
  rows.push({...item,finalWorldHash:replay.finalWorldHash,finalRunnerHash:runner.runnerHash(),inputHash:hashCanonical(replay.inputs),eventHash:hashCanonical(replay.events),recordFile,analysis});
  if(traced){await save(`traces/${item.caseId}.json`,{config:cfg,contentHash:content.bundleHash,traces:runner.traces});traceData.push({item,replay,traces:runner.traces});}
  if(rows.length%20===0){console.log(`Release correctness ${rows.length}/200; per-tick repeat/replay passed`);await save('correctness.partial.json',{rows,restores,comparisons});}
}
assert.equal(restores,30);
// Link actual trace choices to actual outcomes, including the true recovery state at the damage tick.
for(const sample of traceData){const r=sample.replay,sim=new FighterSimulation(content,r.config,undefined,'phase3b-v1');for(const input of r.inputs){const before=sim.snapshot(),out=sim.step(input.intents);for(const e of out.events){let kind=null;if(e.type==='DamageResolved'&&e.payload.amount>=1&&before.entities.find(x=>x.id===e.targetId)?.action.kind==='cast'){const target=before.entities.find(x=>x.id===e.targetId),a=target.action;if(input.tick>=a.startedTick+a.startupTicks+a.activeTicks)kind='successful-punish';}if(e.type==='ProjectileReflected')kind='reflection';if(kind&&!traceExamples[kind]){const actor=kind==='reflection'?e.payload.newOwnerId:e.sourceId,trace=[...sample.traces].reverse().find(x=>x.entityId===actor&&x.trace.nowTick<=e.tick&&x.trace.input.cast);if(trace)traceExamples[kind]={caseId:sample.item.caseId,event:e,traceTick:trace.trace.nowTick,selected:trace.trace.selectedKey,tracePath:`artifacts/phase-5/release/traces/${sample.item.caseId}.json`};}}
  }
  const castEvents=r.events.filter(e=>e.type==='CastAccepted');for(const cast of castEvents){if(!traceExamples.miss&&!r.events.some(e=>e.type==='DamageResolved'&&e.payload.castId===cast.payload.castId&&e.payload.amount>0)&&r.events.some(e=>e.type==='CastFinished'&&e.payload.castId===cast.payload.castId)){const trace=sample.traces.find(x=>x.entityId===cast.sourceId&&x.trace.requestId===cast.payload.requestId);if(trace)traceExamples.miss={caseId:sample.item.caseId,event:cast,traceTick:trace.trace.nowTick,tracePath:`artifacts/phase-5/release/traces/${sample.item.caseId}.json`};}}
  if(!traceExamples.escape){const trace=sample.traces.find(x=>x.trace.stuck&&x.trace.input.moveX!==0&&x.trace.input.moveX!==x.trace.blockedMoveX);if(trace)traceExamples.escape={caseId:sample.item.caseId,traceTick:trace.trace.nowTick,blockedMoveX:trace.trace.blockedMoveX,input:trace.trace.input,tracePath:`artifacts/phase-5/release/traces/${sample.item.caseId}.json`};}
}
await save('correctness.json',{passed:true,engineBuild:'phase3b-v1',aiVersion:'utility-v3',contentHash:content.bundleHash,manifestHash:correct.datasetHash,configs:200,repeatExecutions:400,inputReplayExecutions:200,perTickWorldEqual:true,eventsInputsResultEqual:true,runnerHashesEqual:true,traceAndPreviewInvariant:true,checkpointRestores:restores,futureTickComparisons:comparisons,traceExamples,rows});
const results=[];
for(const item of baseline.cases){const cfg=fighterConfig(content,item.seed,item.a,item.b),u=item.side;cfg.participants[u].participantId='utility';cfg.participants[1-u].participantId='baseline';const runner=new UtilityRunner(content,cfg,{kinds:u===0?['utility',item.baseline]:[item.baseline,'utility'],recordFrames:true,trace:false}),replay=runner.run();assert.notEqual(replay.result.reason,'invalid',item.caseId);const recordFile=`records/${item.caseId}.json.gz`;await writeFile(resolve(directory,recordFile),gzipSync(canonicalSerialize(replay)+'\n'));results.push({...item,winner:replay.result.winnerParticipantId,reason:replay.result.reason,metrics:evaluationMetrics(replay,runner.frames,u+1),baselineMetrics:evaluationMetrics(replay,runner.frames,2-u),recordFile,inputHash:hashCanonical(replay.inputs),finalWorldHash:replay.finalWorldHash,finalRunnerHash:runner.runnerHash()});if(results.length%50===0){console.log(`Release baseline ${results.length}/800`);await save('baseline.partial.json',{n:results.length,results});}}
const groups=['iron','mirror','rubber','standard'].flatMap(character=>['rush','ranged'].flatMap(b=>['train','holdout'].map(split=>({character,baseline:b,split,...aggregateEvaluation(results.filter(r=>r.a===character&&r.baseline===b&&r.split===split))})))),overall=aggregateEvaluation(results);
await save('baseline.json',{passed:true,engineBuild:'phase3b-v1',aiVersion:'utility-v3',pacingMode:'off',contentHash:content.bundleHash,manifestHash:baseline.datasetHash,n:800,train:400,holdout:400,overall,groups,results,parameterTuning:'none; post-Phase5 balancing explicitly deferred by user'});console.log(JSON.stringify({passed:true,correctness:200,baseline:800,restores,traceExamples:Object.keys(traceExamples),overall}));
