import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {readFile} from 'node:fs/promises';
import {loadReplayPackage} from '../dist/node/jobs/replay-store.js';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {fighterWorldHash} from '../dist/node/sim/fighter-state.js';
import {atomicJSON} from '../dist/node/jobs/files.js';
const correctness=JSON.parse(await readFile('artifacts/phase-4/correctness.json','utf8')),rows=[];let hashComparisons=0,inputComparisons=0;
for(const mode of ['off','observe','pace']){const pkg=await loadReplayPackage(resolve(correctness.run,'director',mode)),content=compilePhase3BContent(pkg.content),hashes=new Map(pkg.hashes.map(h=>[h.tick,h]));for(const cp of pkg.checkpoints){if(cp.nextTick>=pkg.manifest.durationTicks)continue;const runner=new UtilityRunner(content,pkg.manifest.config,{kinds:pkg.manifest.runner.kinds,settings:pkg.manifest.runner.settings,recordFrames:false});runner.restore(cp);assert.equal(runner.runnerHash(),cp.runnerHash);while(!runner.sim.snapshot().result){runner.step();const tick=runner.sim.snapshot().tick;assert.deepEqual(runner.inputs.at(-1),pkg.replay.inputs[tick-1]);inputComparisons++;if(hashes.has(tick)){assert.equal(runner.runnerHash(),hashes.get(tick).runnerHash);assert.equal(fighterWorldHash(runner.sim.snapshot()),hashes.get(tick).worldHash);hashComparisons++;}}assert.equal(runner.runnerHash(),pkg.manifest.finalRunnerHash);assert.equal(fighterWorldHash(runner.sim.snapshot()),pkg.manifest.finalWorldHash);rows.push({mode,startTick:cp.nextTick,finalRunnerHash:runner.runnerHash()});}}
await atomicJSON('artifacts/phase-4/checkpoints.json',{passed:true,restores:rows.length,hashComparisons,inputComparisons,allSerializedPackageCPInputsWorldAndRunnerEqual:true,rows});console.log('Serialized formal package checkpoints restored:',rows.length,'restores,',hashComparisons,'future hashes and',inputComparisons,'inputs matched.');
