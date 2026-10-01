import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {compileFighterContent} from '../dist/node/content/fighter.js';
import {FighterRunner,fighterConfig} from '../dist/node/runner/fighter.js';
import {replayInputs} from '../dist/node/runner/input-replay.js';
import {canonicalSerialize} from '../dist/node/math/canonical.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {fighterWorldHash} from '../dist/node/sim/fighter-state.js';
import {FighterSimulation} from '../dist/node/sim/fighter.js';
const directory=resolve('artifacts/phase-1');await mkdir(resolve(directory,'replays'),{recursive:true});
const content=compileFighterContent(JSON.parse(await readFile('content/fighter-phase1.json','utf8'))),manifest=JSON.parse(await readFile('fixtures/seeds/dev-smoke.json','utf8'));
const results=[];const coverage=new Set();
for(const item of manifest.cases){
 const config=fighterConfig(content,item.seed,item.a,item.b);
 const first=new FighterRunner(content,config,['rush','ranged'],true),second=new FighterRunner(content,config,['rush','ranged'],false);
 const hashesA=[],hashesB=[];
 while(!first.sim.snapshot().result){first.step();hashesA.push(fighterWorldHash(first.sim.snapshot()));}
 while(!second.sim.snapshot().result){second.step();hashesB.push(fighterWorldHash(second.sim.snapshot()));}
 const a=first.replay(),b=second.replay();
 try{assert.notEqual(a.result.reason,'invalid');assert.equal(canonicalSerialize(a),canonicalSerialize(b));assert.deepEqual(hashesA,hashesB);replayInputs(a,false);
   const replaySim=new FighterSimulation(content,config),replayHashes=[];for(const entry of a.inputs){replaySim.step(entry.intents);replayHashes.push(fighterWorldHash(replaySim.snapshot()));}assert.deepEqual(hashesA,replayHashes);
 }catch(error){await writeFile(resolve(directory,`${item.caseId}.failure.json`),canonicalSerialize({case:item,error:String(error),a,b,lastState:first.sim.snapshot()})+'\n');throw error;}
 for(const event of a.events)if(event.type==='CastAccepted')coverage.add(event.payload.abilityId);
 const hitCasts=new Set(a.events.filter(e=>e.type==='HitResolved').map(e=>e.payload.castId));
 const misses=a.events.filter(e=>e.type==='CastAccepted'&&!hitCasts.has(e.payload.castId)&&content.source.abilities.find(a=>a.id===e.payload.abilityId).ai.purpose==='damage').map(e=>({tick:e.tick,abilityId:e.payload.abilityId}));
 const bounces=a.events.filter(e=>e.type==='PassiveTriggered').map(e=>e.tick);
 const wallChases=a.events.filter(e=>e.type==='PassiveTriggered').flatMap(e=>{const hit=a.events.find(h=>h.type==='DamageResolved'&&h.sourceId===e.sourceId&&h.tick>e.tick&&h.tick<=e.tick+180);return hit?[{entityId:e.sourceId,bounceTick:e.tick,damageTick:hit.tick}]:[];});
 const replayPath=`artifacts/phase-1/replays/${item.caseId}.json`;await writeFile(replayPath,canonicalSerialize(a)+'\n');
 results.push({caseId:item.caseId,seed:item.seed,a:item.a,b:item.b,ticks:a.inputs.length,result:a.result,worldSequenceHash:hashCanonical(hashesA),finalWorldHash:a.finalWorldHash,eventCount:a.events.length,damageEvents:a.events.filter(e=>e.type==='DamageResolved').length,wallGrowthTicks:bounces,wallChases:wallChases.slice(0,4),misses:misses.slice(0,8),replayPath});
 console.log(`${results.length}/30 ${item.caseId}: ${a.result.reason}, ${a.inputs.length} ticks, wall growth ${bounces.length}`);
}
assert.equal(results.length,30);assert.equal(coverage.size,8,'all 8 abilities must be accepted across development battles');assert(results.some(r=>r.wallGrowthTicks.length));assert(results.some(r=>r.misses.length));assert(results.some(r=>r.result.reason==='ko'||r.result.reason==='double-ko'));
const timeoutRunner=new FighterRunner(content,fighterConfig(content,17),['idle','idle'],false),timeoutReplay=timeoutRunner.run();assert.equal(timeoutReplay.result.reason,'timeout');replayInputs(timeoutReplay,false);await writeFile(resolve(directory,'replays/timeout-idle.json'),canonicalSerialize(timeoutReplay)+'\n');
// Two separate Node processes: output must be byte identical, including input/events.
const cliFiles=['process-a.json','process-b.json'].map(name=>resolve(directory,name));
for(const path of cliFiles){const proc=spawnSync(process.execPath,['dist/node/cli/simulate.js','--a','standard','--b','rubber','--seed','17','--output',path],{encoding:'utf8'});assert.equal(proc.status,0,proc.stderr);}
assert.equal(await readFile(cliFiles[0],'utf8'),await readFile(cliFiles[1],'utf8'));
const overloaded=structuredClone(content.source),bolt=overloaded.abilities.find(a=>a.id==='standard-bolt'),bullet=bolt.timeline[0].effects[0];bolt.timeline=[{offsetTick:12,effects:Array.from({length:32},()=>structuredClone(bullet))},{offsetTick:12,effects:[structuredClone(bullet)]}];
const overloadPath=resolve(directory,'overload-content.json'),failurePath=resolve(directory,'limit.json');await writeFile(overloadPath,JSON.stringify(overloaded));
const invalidProcess=spawnSync(process.execPath,['dist/node/cli/simulate.js','--a','standard','--b','rubber','--seed','17','--controller-a','ranged','--content',overloadPath,'--output',failurePath],{encoding:'utf8'});assert.equal(invalidProcess.status,2,invalidProcess.stderr);const failure=JSON.parse(await readFile(failurePath+'.failure.json','utf8'));assert.equal(failure.state.result.reason,'invalid');assert(failure.state.diagnostics[0].detail.includes('budget'));replayInputs(JSON.parse(await readFile(failurePath,'utf8')),false);
assert(results.some(r=>r.wallChases.length));
const representatives={wallChase:results.find(r=>r.wallChases.length),miss:results.find(r=>r.misses.length),ko:results.find(r=>r.result.reason==='ko'||r.result.reason==='double-ko'),timeout:{seed:17,a:'standard',b:'rubber',controllers:['idle','idle'],result:timeoutReplay.result,replayPath:'artifacts/phase-1/replays/timeout-idle.json'}};
const report={passed:true,engineBuild:'phase1-v1',node:process.version,contentHash:content.bundleHash,datasetHash:manifest.datasetHash,cases:30,repeatExecutions:60,inputReplays:30,fullWorldSequenceComparisons:60,traceOnOffEqual:true,independentProcessesEqual:true,invalidCliFailurePackageVerified:true,failurePackagePath:'artifacts/phase-1/limit.json.failure.json',coveredAbilities:[...coverage].sort(),representatives,results};
await writeFile(resolve(directory,'smoke.json'),JSON.stringify(report,null,2));console.log(`Phase 1 smoke passed: 30 configs, 60 executions, 30 input replays, all ${coverage.size} abilities.`);
