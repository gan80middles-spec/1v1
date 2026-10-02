import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {compilePhase3AContent} from '../dist/node/content/phase3a.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {canonicalSerialize} from '../dist/node/math/canonical.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {replayInputs} from '../dist/node/runner/input-replay.js';
const manifest=JSON.parse(await readFile('fixtures/seeds/ai-baseline-v1.json','utf8')),content=compilePhase3AContent(JSON.parse(await readFile('content/fighter-phase3a.json','utf8'))),baseline=JSON.parse(await readFile('artifacts/phase-3a/evaluation/baseline.json','utf8')),rows=[];assert.equal(baseline.results.length,800);
for(const item of manifest.cases){const cfg=fighterConfig(content,item.seed,item.a,item.b),u=item.side;cfg.participants[u].participantId='utility';cfg.participants[1-u].participantId='baseline';const runner=new UtilityRunner(content,cfg,{kinds:u===0?['utility',item.baseline]:[item.baseline,'utility'],recordFrames:false}),replay=runner.run(),old=JSON.parse(gunzipSync(await readFile(resolve('artifacts/phase-3a/evaluation/records',`control-${item.caseId}.json.gz`))).toString('utf8'));assert.equal(canonicalSerialize(replay),canonicalSerialize(old),item.caseId+' frozen Phase3A replay');assert.equal(runner.runnerHash(),baseline.results.find(r=>r.caseId===item.caseId).finalRunnerHash);rows.push({caseId:item.caseId,inputHash:hashCanonical(replay.inputs),finalWorldHash:replay.finalWorldHash,runnerHash:runner.runnerHash()});if(rows.length%50===0)console.log(`Frozen Phase3A baseline preservation ${rows.length}/800`);}
const correct=JSON.parse(await readFile('fixtures/seeds/correctness-v1.json','utf8'));for(const item of correct.cases){const r=JSON.parse(gunzipSync(await readFile(resolve('artifacts/phase-3a/correctness/records',`${item.caseId}.json.gz`))).toString('utf8'));replayInputs(r,false);}
await writeFile('artifacts/phase-3b/legacy.json',canonicalSerialize({passed:true,baselineExecutions:800,baselineReplayByteEqual:true,runnerHashesEqual:true,legacyCorrectnessInputReplays:200,manifestHash:manifest.datasetHash,rows})+'\n');console.log('800 frozen baseline replays/future hashes and 200 legacy input replays unchanged.');
