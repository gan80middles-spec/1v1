import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {compilePhase3AContent} from '../dist/node/content/phase3a.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {FighterSimulation} from '../dist/node/sim/fighter.js';
import {fighterWorldHash,PHASE3A_RULES_HASH} from '../dist/node/sim/fighter-state.js';
import {replayInputs} from '../dist/node/runner/input-replay.js';
import {canonicalSerialize} from '../dist/node/math/canonical.js';
import {hashCanonical} from '../dist/node/math/hash.js';
const directory=resolve('artifacts/phase-3a'),dir=resolve(directory,'correctness');await mkdir(resolve(dir,'records'),{recursive:true});await mkdir(resolve(directory,'replays'),{recursive:true});
const source=JSON.parse(await readFile('content/fighter-phase3a.json','utf8')),content=compilePhase3AContent(source),manifest=JSON.parse(await readFile('fixtures/seeds/correctness-v1.json','utf8')),{datasetHash,...body}=manifest;
assert.equal(hashCanonical(body),datasetHash);assert.equal(manifest.cases.length,200);assert.equal(manifest.repetitions,2);
const save=async(path,value)=>writeFile(path,canonicalSerialize(value)+'\n'),results=[],coverage=new Set(),mechanisms={reflect:0,dissipate:0,giant:0,brace:0,wallGrowth:0};let recoveryCases=0;
for(const item of manifest.cases){
  const config=fighterConfig(content,item.seed,item.a,item.b),a=new UtilityRunner(content,config,{trace:true,recordFrames:false}),hashes=[],runnerHashes=[],checkpoints=new Map();
  while(!a.sim.snapshot().result){if(item.sampleIndex===0&&[120,240].includes(a.sim.snapshot().tick))checkpoints.set(a.sim.snapshot().tick,a.snapshot(true));a.step();hashes.push(fighterWorldHash(a.sim.snapshot()));if(a.sim.snapshot().tick%60===0||a.sim.snapshot().result)runnerHashes.push({tick:a.sim.snapshot().tick,hash:a.runnerHash()});}
  const replay=a.replay();
  if(replay.result.reason==='invalid'){await save(resolve(dir,`${item.caseId}.failure.json`),{item,content:content.source,checkpoint:a.snapshot(true),traces:a.traces});throw Error('Invalid correctness '+item.caseId);}
  const b=new UtilityRunner(content,config,{trace:false,recordFrames:false}),otherHashes=[],otherRunnerHashes=[];
  while(!b.sim.snapshot().result){b.step();otherHashes.push(fighterWorldHash(b.sim.snapshot()));if(b.sim.snapshot().tick%60===0||b.sim.snapshot().result)otherRunnerHashes.push({tick:b.sim.snapshot().tick,hash:b.runnerHash()});}
  assert.deepEqual(otherHashes,hashes,item.caseId+' per-tick world');assert.deepEqual(otherRunnerHashes,runnerHashes,item.caseId+' runner checkpoints');assert.equal(canonicalSerialize(replay),canonicalSerialize(b.replay()),item.caseId+' events/input/result');
  const sim=new FighterSimulation(content,config,undefined,'phase3a-v1'),inputEvents=[];
  for(const entry of replay.inputs){const out=sim.step(entry.intents);inputEvents.push(...out.events);assert.equal(fighterWorldHash(out.state),hashes[out.state.tick-1],item.caseId+' input replay');}
  assert.deepEqual(inputEvents,replay.events);
  if(item.sampleIndex===0){
    const near=new UtilityRunner(content,config,{recordFrames:false});while(near.sim.snapshot().tick<replay.inputs.length-1)near.step();checkpoints.set(near.sim.snapshot().tick,near.snapshot(true));
    for(const [tick,cp]of checkpoints){const restored=new UtilityRunner(content,config,{trace:false,recordFrames:false});restored.restore(JSON.parse(JSON.stringify(cp)));while(!restored.sim.snapshot().result){restored.step();assert.deepEqual(restored.inputs.at(-1),replay.inputs[restored.sim.snapshot().tick-1]);assert.equal(fighterWorldHash(restored.sim.snapshot()),hashes[restored.sim.snapshot().tick-1]);const reference=runnerHashes.find(c=>c.tick===restored.sim.snapshot().tick);if(reference)assert.equal(restored.runnerHash(),reference.hash);}assert.deepEqual(restored.replay(),replay);assert.equal(restored.runnerHash(),a.runnerHash());recoveryCases++;}
    await save(resolve(directory,'replays',`${item.caseId}.json`),replay);
    await save(resolve(directory,'replays',`${item.caseId}.trace.json`),{config,contentHash:content.bundleHash,traces:a.traces});
  }
  for(const e of replay.events){if(e.type==='CastAccepted')coverage.add(e.payload.abilityId);if(e.type==='ProjectileReflected')mechanisms.reflect++;if(e.type==='ProjectileDissipated')mechanisms.dissipate++;if(e.type==='StatusApplied'&&e.payload.statusId==='giant')mechanisms.giant++;if(e.type==='StatusApplied'&&e.payload.statusId==='brace')mechanisms.brace++;if(e.type==='PassiveTriggered')mechanisms.wallGrowth++;}
  await writeFile(resolve(dir,'records',`${item.caseId}.json.gz`),gzipSync(canonicalSerialize(replay)+'\n',{level:6}));
  results.push({...item,ticks:replay.inputs.length,result:replay.result,finalWorldHash:replay.finalWorldHash,finalRunnerHash:a.runnerHash(),worldSequenceHash:hashCanonical(hashes),runnerSequenceHash:hashCanonical(runnerHashes),inputHash:hashCanonical(replay.inputs),recordFile:`records/${item.caseId}.json.gz`});
  if(results.length%10===0){console.log(`Correctness ${results.length}/200: repeat, input replay and trace equality passed`);await save(resolve(dir,'partial.json'),{status:'running',contentHash:content.bundleHash,manifestHash:datasetHash,n:results.length,results});}
}
assert.equal(results.length,200);assert.equal(recoveryCases,30);
for(const file of ['independent-a.json','independent-b.json']){const p=spawnSync(process.execPath,['dist/node/cli/simulate.js','--ai','utility','--build','phase3a-v1','--a','iron','--b','mirror','--seed','17','--output',resolve(directory,file),'--checkpoint-at','240','--checkpoint',resolve(directory,`${file}.checkpoint.json`)],{encoding:'utf8'});assert.equal(p.status,0,p.stderr);}
assert.equal(await readFile(resolve(directory,'independent-a.json'),'utf8'),await readFile(resolve(directory,'independent-b.json'),'utf8'));
const resumed=spawnSync(process.execPath,['dist/node/cli/simulate.js','--resume',resolve(directory,'independent-a.json.checkpoint.json'),'--output',resolve(directory,'independent-resumed.json')],{encoding:'utf8'});assert.equal(resumed.status,0,resumed.stderr);assert.equal(await readFile(resolve(directory,'independent-a.json'),'utf8'),await readFile(resolve(directory,'independent-resumed.json'),'utf8'));
const free=spawnSync(process.execPath,['dist/node/cli/simulate.js','--ai','utility','--build','phase3a-v1','--a','standard','--b','standard','--seed','17','--ruleset','free-bounce-fixture','--output',resolve(directory,'free-bounce.json')],{encoding:'utf8'});assert.equal(free.status,0,free.stderr);const fixture=JSON.parse(await readFile(resolve(directory,'free-bounce.json'),'utf8'));assert.equal(fixture.inputs.length,600);assert.equal(fixture.result.reason,'timeout');assert(!fixture.events.some(e=>e.type==='Jumped'));replayInputs(fixture,false);
const report={passed:true,engineBuild:'phase3a-v1',aiVersion:'utility-v2',pacingMode:'off',contentHash:content.bundleHash,rulesHash:PHASE3A_RULES_HASH,manifestHash:datasetHash,configs:200,repeatExecutions:400,inputReplayExecutions:200,perTickWorldEqual:true,eventsInputsResultEqual:true,runnerCheckpointEqual:true,traceOnOffEqual:true,checkpointConfigs:10,checkpointRestores:30,checkpointTicks:[120,240,'actual-end-minus-1'],independentProcessesByteEqual:true,cliResumeByteEqual:true,freeBounce:{ticks:600,jumpDisabled:true,zeroGravity:true,finalWorldHash:fixture.finalWorldHash},coveredAbilities:[...coverage].sort(),mechanisms,results};
await save(resolve(directory,'correctness.json'),report);console.log(JSON.stringify({passed:true,configs:200,repeatExecutions:400,inputReplayExecutions:200,checkpointRestores:30,coveredAbilities:report.coveredAbilities,mechanisms},null,2));
