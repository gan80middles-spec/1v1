import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gzipSync,gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {compilePhase3AContent} from '../dist/node/content/phase3a.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {replayInputs} from '../dist/node/runner/input-replay.js';
import {fighterWorldHash} from '../dist/node/sim/fighter-state.js';
import {FighterSimulation} from '../dist/node/sim/fighter.js';
import {canonicalSerialize} from '../dist/node/math/canonical.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {mechanismEvidence} from './pacing-evidence.mjs';
if(process.version!=='v24.21.0')throw Error('Use the locked Node runtime');
const directory=resolve('artifacts/phase-3b'),content=compilePhase3BContent(JSON.parse(await readFile('content/fighter-phase3b.json','utf8'))),legacy=compilePhase3AContent(JSON.parse(await readFile('content/fighter-phase3a.json','utf8'))),manifest=JSON.parse(await readFile('fixtures/seeds/pacing-pairs-v1.json','utf8')),evaluation=JSON.parse(await readFile(resolve(directory,'evaluation.json'),'utf8'));
assert.equal(evaluation.configs,200);assert.equal(evaluation.contentHash,content.bundleHash);assert.equal(evaluation.manifestHash,manifest.datasetHash);await mkdir(resolve(directory,'mechanisms'),{recursive:true});
const load=async(path)=>JSON.parse(gunzipSync(await readFile(path)).toString('utf8')),save=(p,data)=>writeFile(p,canonicalSerialize(data)+'\n');
const rows=[],mechanisms={};let restoreCount=0,checkpointsCompared=0;
for(const item of manifest.cases){
 const off=await load(resolve(directory,'records',`${item.caseId}-off.json.gz`)),pace=await load(resolve(directory,'records',`${item.caseId}-pace.json.gz`));
 for(const r of [off,pace])assert.equal(replayInputs(r,false).replay.finalWorldHash,r.finalWorldHash);
 const observeCfg=structuredClone(off.config);observeCfg.pacing={mode:'observe',profileId:'gentle-v1'};const observe=new UtilityRunner(content,observeCfg,{recordFrames:false,directorLog:false}),observed=observe.run();assert.equal(canonicalSerialize(observed.inputs),canonicalSerialize(off.inputs),item.caseId+' off/observe inputs');
 const repeat=new UtilityRunner(content,pace.config,{trace:true,recordFrames:true,directorLog:false}),snapshots=new Map(),runnerHashes=new Map(),worldHashes=[];let cueCaptured=false,priorUpdateCheckpoint=null;
 while(!repeat.sim.snapshot().result){const tick=repeat.sim.snapshot().tick;if(item.sampleIndex===0||item.sampleIndex===10){const cue=repeat.director.currentCue;if(cue&&!cueCaptured){assert(priorUpdateCheckpoint);snapshots.set(priorUpdateCheckpoint.nextTick,priorUpdateCheckpoint);snapshots.set(cue.applyTick+40,null);snapshots.set(cue.expiresTick-10,null);cueCaptured=true;}if(tick===repeat.director.nextUpdateTick)priorUpdateCheckpoint=repeat.snapshot(true);if(snapshots.has(tick)&&snapshots.get(tick)===null)snapshots.set(tick,repeat.snapshot(true));}
  repeat.step();const now=repeat.sim.snapshot().tick;worldHashes.push(fighterWorldHash(repeat.sim.snapshot()));if(now%60===0||repeat.sim.snapshot().result)runnerHashes.set(now,repeat.runnerHash());
 }
 const rr=repeat.replay();assert.equal(canonicalSerialize(rr.inputs),canonicalSerialize(pace.inputs));assert.equal(canonicalSerialize(rr.events),canonicalSerialize(pace.events));assert.equal(rr.finalWorldHash,pace.finalWorldHash);const reference=evaluation.results.find(r=>r.caseId===item.caseId).pace;assert.equal(repeat.runnerHash(),reference.runnerHash,item.caseId+' log on/off future hash');
 const inputSim=new FighterSimulation(content,pace.config,undefined,'phase3b-v1');for(const entry of pace.inputs){const out=inputSim.step(entry.intents);assert.equal(fighterWorldHash(out.state),worldHashes[out.state.tick-1],item.caseId+' per-tick pure input world');}
 for(const [tick,cp]of snapshots){if(!cp||tick>=rr.inputs.length)continue;const restored=new UtilityRunner(content,pace.config,{trace:false,recordFrames:false,directorLog:false});restored.restore(JSON.parse(JSON.stringify(cp)));while(!restored.sim.snapshot().result){restored.step();const now=restored.sim.snapshot().tick;assert.deepEqual(restored.inputs.at(-1),pace.inputs[now-1]);assert.equal(fighterWorldHash(restored.sim.snapshot()),worldHashes[now-1]);if(runnerHashes.has(now)){assert.equal(restored.runnerHash(),runnerHashes.get(now));checkpointsCompared++;}}
  assert.equal(restored.runnerHash(),repeat.runnerHash());assert.deepEqual(restored.replay(),rr);restoreCount++;}
 for(const kind of ['engage','vary','showcase'])if(!mechanisms[kind]){const evidence=mechanismEvidence(repeat,pace,kind);if(evidence){mechanisms[kind]={...item,...evidence};await save(resolve(directory,'mechanisms',kind+'.json'),pace);await save(resolve(directory,'mechanisms',kind+'.trace.json'),{config:pace.config,contentHash:content.bundleHash,traces:repeat.traces});await save(resolve(directory,'mechanisms',kind+'.evidence.json'),mechanisms[kind]);}}
 const original=new UtilityRunner(legacy,fighterConfig(legacy,item.seed,item.a,item.b),{recordFrames:false}).run();assert.equal(canonicalSerialize(original.inputs),canonicalSerialize(off.inputs),item.caseId+' Phase3A off input preservation');assert.equal(canonicalSerialize(original.events),canonicalSerialize(off.events));
 rows.push({caseId:item.caseId,offObserveEqual:true,repeatEqual:true,logToggleFutureHashEqual:true,inputReplayOff:off.finalWorldHash,inputReplayPace:pace.finalWorldHash,phase3AInputsEventsEqual:true,restoreTicks:[...snapshots].filter(([,cp])=>cp).map(([tick])=>tick)});
 if(rows.length%10===0){console.log(`Pacing correctness ${rows.length}/200`);await save(resolve(directory,'correctness.partial.json'),{status:'running',rows,restoreCount});}
}
for(const kind of ['engage','vary','showcase'])assert(mechanisms[kind],kind+' actual changed selection evidence missing');assert(restoreCount>=20);
const runCLI=(args)=>{const r=spawnSync(process.execPath,['dist/node/cli/simulate.js',...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);};
for(const name of ['a','b'])runCLI(['--ai','utility','--pacing','pace','--seed','17','--a','mirror','--b','rubber','--output',resolve(directory,`independent-${name}.json`),'--checkpoint-at','240','--checkpoint',resolve(directory,`independent-${name}.checkpoint.json`)]);
assert.equal(await readFile(resolve(directory,'independent-a.json'),'utf8'),await readFile(resolve(directory,'independent-b.json'),'utf8'));
runCLI(['--resume',resolve(directory,'independent-a.checkpoint.json'),'--output',resolve(directory,'independent-resumed.json')]);assert.equal(await readFile(resolve(directory,'independent-a.json'),'utf8'),await readFile(resolve(directory,'independent-resumed.json'),'utf8'));
const invalidResume=spawnSync(process.execPath,['dist/node/cli/simulate.js','--resume',resolve(directory,'independent-a.checkpoint.json'),'--pacing','off'],{encoding:'utf8'});assert.equal(invalidResume.status,2);assert.match(invalidResume.stderr,/saved pacing mode/);
const report={passed:true,engineBuild:'phase3b-v1',aiVersion:'utility-v3',contentHash:content.bundleHash,manifestHash:manifest.datasetHash,configs:200,inputReplayExecutions:400,pacePerTickInputReplayExecutions:200,offObserveExecutions:200,paceRepeatExecutions:200,phase3AOffPreservationExecutions:200,restoreCount,checkpointsCompared,perTickRestoredWorldAndInputEqual:true,independentProcessesByteEqual:true,cliResumeByteEqual:true,mechanisms,rows};await save(resolve(directory,'correctness.json'),report);console.log(JSON.stringify({...report,rows:undefined,mechanisms:Object.fromEntries(Object.entries(mechanisms).map(([k,v])=>[k,{caseId:v.caseId,tick:v.tick,selected:v.selectedKey,withoutDirector:v.counterfactual.selectedKey,actualDamage:v.actualDamage,buffEvents:v.buffEvidence.length}]))},null,2));
