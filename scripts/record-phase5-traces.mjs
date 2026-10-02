import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {resolve} from 'node:path';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {canonicalSerialize} from '../dist/node/math/canonical.js';
const directory=resolve('artifacts/phase-5/release'),report=JSON.parse(await readFile(resolve(directory,'correctness.json'),'utf8'));
for(const row of report.rows){const replay=JSON.parse(gunzipSync(await readFile(resolve(directory,row.recordFile))).toString('utf8')),event=replay.events.find(e=>e.type==='ProjectileReflected'&&e.payload.defenseCastId!==null);if(!event)continue;
  const content=compilePhase3BContent(replay.content),runner=new UtilityRunner(content,replay.config,{trace:true,recordFrames:false}),generated=runner.run();assert.equal(hashCanonical(generated.inputs),row.inputHash);assert.equal(generated.finalWorldHash,row.finalWorldHash);assert.equal(runner.runnerHash(),row.finalRunnerHash);
  const cast=replay.events.find(e=>e.type==='CastAccepted'&&e.payload.castId===event.payload.defenseCastId),trace=runner.traces.find(t=>t.entityId===event.sourceId&&t.trace.requestId===cast?.payload.requestId);assert(trace,'Actual defense cast must link to originating Utility trace');
  const tracePath=`artifacts/phase-5/release/traces/${row.caseId}.json`;await writeFile(tracePath,canonicalSerialize({config:replay.config,contentHash:content.bundleHash,traces:runner.traces})+'\n');report.traceExamples.reflection={caseId:row.caseId,event,traceTick:trace.trace.nowTick,selectedKey:trace.trace.selectedKey,defenseCast:cast,tracePath};break;
}
for(const kind of ['successful-punish','miss','escape','reflection'])assert(report.traceExamples[kind],kind+' trace missing');
await writeFile(resolve(directory,'trace-examples.json'),JSON.stringify({passed:true,engineBuild:report.engineBuild,contentHash:report.contentHash,examples:report.traceExamples},null,2)+'\n');console.log('Four current-build actual outcome/choice traces linked.');
