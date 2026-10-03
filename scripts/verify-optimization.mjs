import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {replayInputs} from '../dist/node/runner/input-replay.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {argumentsFor,loadManifest,caseConfig} from './optimization-common.mjs';
const args=argumentsFor(['--content','--version','--manifest','--output']);
for(const key of ['--content','--version','--manifest','--output'])assert(args[key]);
const content=compilePhase3BContent(JSON.parse(await readFile(args['--content'],'utf8'))),manifest=await loadManifest(args['--manifest']);
const directory=resolve(args['--output']);await mkdir(directory,{recursive:true});
const rows=[];let restores=0,futureTicks=0,maxCandidates=0,maxSegments=0,maxHistory=0;
for(const item of manifest.cases){
  const cfg=caseConfig(content,item),inspect=item.sampleIndex===0||item.sampleIndex===10;
  const runner=new UtilityRunner(content,cfg,{recordFrames:false,trace:inspect});assert.equal(runner.aiVersion,args['--version']);
  let cp;
  while(!runner.sim.snapshot().result){if(inspect&&runner.sim.snapshot().tick===120)cp=JSON.parse(JSON.stringify(runner.snapshot(true)));runner.step();}
  const replay=runner.replay(),repeat=new UtilityRunner(content,cfg,{recordFrames:false});
  assert.notEqual(replay.result.reason,'invalid');assert.deepEqual(repeat.run(),replay);assert.equal(repeat.runnerHash(),runner.runnerHash());
  assert.equal(replayInputs(replay,false).replay.finalWorldHash,replay.finalWorldHash);
  for(const {trace}of runner.traces){maxCandidates=Math.max(maxCandidates,trace.candidates.length);for(const c of trace.candidates){maxSegments=Math.max(maxSegments,c.outcome?.segmentsUsed??0);if(c.option.slot==='basic'&&c.outcome?.castDamageDealtPct===0)assert(!c.eligible);}}
  for(const c of runner.snapshot().controllers)if(c.kind==='utility')maxHistory=Math.max(maxHistory,c.data.memory.ownMotionHistory?.length??0);
  if(cp){const restored=new UtilityRunner(content,cfg,{recordFrames:false});restored.restore(cp);
    while(!restored.sim.snapshot().result){restored.step();assert.deepEqual(restored.inputs.at(-1),replay.inputs[restored.sim.snapshot().tick-1]);futureTicks++;}
    assert.equal(restored.runnerHash(),runner.runnerHash());restores++;
  }
  rows.push({...item,inputHash:hashCanonical(replay.inputs),worldHash:replay.finalWorldHash,runnerHash:runner.runnerHash()});
  if(rows.length%20===0)console.log(`Correctness ${rows.length}/${manifest.cases.length}`);
}
assert(maxCandidates<=18&&maxSegments<=12&&maxHistory<=19);assert(restores>=20);
const report={passed:true,aiVersion:args['--version'],contentHash:content.bundleHash,manifestHash:manifest.datasetHash,configs:rows.length,
  repeatExecutions:rows.length,inputReplays:rows.length,restores,futureTicks,maxCandidates,maxSegments,maxHistory,rows};
await writeFile(resolve(directory,'correctness.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,rows:undefined}));
