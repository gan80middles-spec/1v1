import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {cpus,platform,release,totalmem} from 'node:os';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {deriveSeed} from '../dist/node/math/random.js';
import {canonicalSerialize} from '../dist/node/math/canonical.js';
import {hashCanonical} from '../dist/node/math/hash.js';
const manifest=JSON.parse(await readFile('fixtures/seeds/pacing-pairs-v1.json','utf8')),content=compilePhase3BContent(JSON.parse(await readFile('content/fighter-phase3b.json','utf8'))),warm=manifest.cases.filter(c=>c.sampleIndex===0),cases=manifest.cases.filter(c=>c.sampleIndex>=1&&c.sampleIndex<=3),rows=[];assert.equal(warm.length,10);assert.equal(cases.length,30);
function execute(item,mode){const cfg=fighterConfig(content,item.seed,item.a,item.b);cfg.pacing={mode,profileId:mode==='off'?null:'gentle-v1'};const runner=new UtilityRunner(content,cfg,{recordFrames:false,trace:false}),start=performance.now(),replay=runner.run(),elapsedMs=performance.now()-start;assert.notEqual(replay.result.reason,'invalid');return {elapsedMs,ticks:replay.inputs.length,inputHash:hashCanonical(replay.inputs),rss:process.memoryUsage().rss};}
for(const item of warm)for(const mode of ['off','observe','pace'])execute(item,mode);
for(let repetition=0;repetition<3;repetition++)for(const item of cases){const modes=['off','observe','pace'].sort((a,b)=>deriveSeed(2026,'pacing-cost',item.caseId,repetition,a)-deriveSeed(2026,'pacing-cost',item.caseId,repetition,b));for(const mode of modes)rows.push({caseId:item.caseId,repetition,mode,...execute(item,mode)});if(rows.length%30===0)console.log(`Pacing cost ${rows.length}/270`);}
const totals={};for(const mode of ['off','observe','pace']){const group=rows.filter(r=>r.mode===mode),elapsedMs=group.reduce((s,r)=>s+r.elapsedMs,0),ticks=group.reduce((s,r)=>s+r.ticks,0);totals[mode]={executions:group.length,elapsedMs,ticks,msPerTick:elapsedMs/ticks,realtimeMultiple:ticks/60/(elapsedMs/1000),maxRssMiB:Math.max(...group.map(r=>r.rss))/1024/1024};}
for(const item of cases)for(const mode of ['off','observe','pace'])assert.equal(new Set(rows.filter(r=>r.caseId===item.caseId&&r.mode===mode).map(r=>r.inputHash)).size,1);
const report={passed:true,contentHash:content.bundleHash,manifestHash:manifest.datasetHash,subsetHash:hashCanonical(cases),benchmark:'pacing-cost-v1',warmupMatches:30,measuredMatches:270,configurations:30,repetitions:3,settings:{trace:false,recordFrames:false,directorLog:true},naturalEarlyTermination:true,costDefinition:'Elapsed runner.run() excluding metrics, input hash and file IO; normalized by executed ticks. Rotated mode order, warmed all ten matchups.',machine:{node:process.version,v8:process.versions.v8,os:platform(),release:release(),cpu:cpus()[0]?.model,logicalCores:cpus().length,memoryBytes:totalmem()},totals,observeOverheadFraction:totals.observe.msPerTick/totals.off.msPerTick-1,paceOverheadFraction:totals.pace.msPerTick/totals.off.msPerTick-1,rows};await writeFile('artifacts/phase-3b/cost.json',canonicalSerialize(report)+'\n');console.log(JSON.stringify({...report,rows:undefined},null,2));
