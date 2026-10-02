import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {cpus,release} from 'node:os';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {hashCanonical} from '../dist/node/math/hash.js';
const manifest=JSON.parse(await readFile('fixtures/seeds/performance-v1.json','utf8')),{datasetHash,...body}=manifest;assert.equal(hashCanonical(body),datasetHash);
const contents={};for(const [version,file]of [['v3','fighter-phase3b'],['v4','fighter-calibrated']]){const source=JSON.parse(await readFile(`content/${file}.json`,'utf8'));for(const c of source.characters)c.stats.maxHp=1000;contents[version]=compilePhase3BContent(source);}
function run(item,version){const content=contents[version],runner=new UtilityRunner(content,fighterConfig(content,item.seed,item.a,item.b,2700),{recordFrames:false,trace:false});const cpu=process.cpuUsage(),start=performance.now();const replay=runner.run(),wallMs=performance.now()-start,used=process.cpuUsage(cpu);assert.equal(replay.inputs.length,2700);assert.equal(replay.result.reason,'timeout');return{caseId:item.caseId,version,ticks:2700,wallMs,cpuMs:(used.user+used.system)/1000,rss:process.memoryUsage().rss};}
for(const item of manifest.cases.slice(0,10))for(const version of ['v3','v4'])run(item,version);
console.log('Warmed 10 fixed-duration matches per version');const rows=[];
for(const [i,item]of manifest.cases.slice(10).entries()){for(const version of i%2?['v4','v3']:['v3','v4'])rows.push(run(item,version));if((i+1)%20===0)console.log(`Benchmark ${i+1}/100 pairs`);}
const quantile=(v,q)=>[...v].sort((a,b)=>a-b)[Math.ceil(v.length*q)-1],summary={};
for(const version of ['v3','v4']){const r=rows.filter(r=>r.version===version),wallMs=r.reduce((s,r)=>s+r.wallMs,0);summary[version]={matches:r.length,ticks:r.length*2700,wallSeconds:wallMs/1000,totalProcessCpuSeconds:r.reduce((s,r)=>s+r.cpuMs,0)/1000,realtimeMultiple:r.length*45/(wallMs/1000),medianMs:quantile(r.map(r=>r.wallMs),.5),p95Ms:quantile(r.map(r=>r.wallMs),.95),maxSampledRssMiB:Math.max(...r.map(r=>r.rss))/1048576};}
const report={passed:true,node:process.version,cpu:cpus()[0].model,os:release(),manifestHash:datasetHash,contentHashes:Object.fromEntries(Object.entries(contents).map(([k,c])=>[k,c.bundleHash])),measurement:'Single process, sequential alternating pairs, 10 warmup + 100 measured per version, 2700 ticks each, benchmark-only HP=1000, director off, trace/frames off. CPU is whole-process usage, not AI-only fraction.',summary,rows};
await mkdir('artifacts/calibration/verification',{recursive:true});await writeFile('artifacts/calibration/verification/benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,rows:undefined}));
