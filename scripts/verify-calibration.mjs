import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {replayInputs} from '../dist/node/runner/input-replay.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {fighterWorldHash} from '../dist/node/sim/fighter-state.js';
const content=compilePhase3BContent(JSON.parse(await readFile('content/fighter-calibrated.json','utf8')));
const manifest=JSON.parse(await readFile('fixtures/seeds/correctness-v1.json','utf8'));
const {datasetHash,...body}=manifest;assert.equal(hashCanonical(body),datasetHash);
const rows=[];let restores=0,futureTicks=0,maxCandidates=0,maxSegments=0;
for(const item of manifest.cases){
  const config=fighterConfig(content,item.seed,item.a,item.b),inspect=item.sampleIndex===0||item.sampleIndex===10;
  const a=new UtilityRunner(content,config,{recordFrames:false,trace:inspect});let cp;
  while(!a.sim.snapshot().result){if(inspect&&a.sim.snapshot().tick===120)cp=JSON.parse(JSON.stringify(a.snapshot(true)));a.step();}
  const replay=a.replay(),b=new UtilityRunner(content,config,{recordFrames:false}),repeat=b.run();
  assert.notEqual(replay.result.reason,'invalid');assert.equal(a.aiVersion,'utility-v4');
  assert.deepEqual(repeat,replay);assert.equal(b.runnerHash(),a.runnerHash());
  assert.equal(replayInputs(replay,false).replay.finalWorldHash,replay.finalWorldHash);
  for(const {trace}of a.traces){maxCandidates=Math.max(maxCandidates,trace.candidates.length);for(const c of trace.candidates){maxSegments=Math.max(maxSegments,c.outcome?.segmentsUsed??0);if(c.option.slot==='basic'&&c.outcome?.castDamageDealtPct===0)assert(!c.eligible);}}
  if(cp){const restored=new UtilityRunner(content,config,{recordFrames:false});restored.restore(cp);while(!restored.sim.snapshot().result){restored.step();assert.deepEqual(restored.inputs.at(-1),replay.inputs[restored.sim.snapshot().tick-1]);futureTicks++;}assert.equal(restored.runnerHash(),a.runnerHash());assert.equal(fighterWorldHash(restored.sim.snapshot()),replay.finalWorldHash);restores++;}
  rows.push({...item,inputHash:hashCanonical(replay.inputs),worldHash:replay.finalWorldHash,runnerHash:a.runnerHash()});
  if(rows.length%20===0)console.log(`v4 correctness ${rows.length}/${manifest.cases.length}`);
}
assert(maxCandidates<=18);assert(maxSegments<=12);assert(restores>=20);
await mkdir('artifacts/calibration/verification',{recursive:true});
const report={passed:true,contentHash:content.bundleHash,manifestHash:datasetHash,configs:rows.length,repeatExecutions:rows.length,inputReplays:rows.length,restores,futureTicks,maxCandidates,maxSegments,rows};
await writeFile('artifacts/calibration/verification/correctness.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,rows:undefined}));
