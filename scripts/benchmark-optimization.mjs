import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {cpus,release} from 'node:os';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {argumentsFor,loadManifest,quantile} from './optimization-common.mjs';
const args=argumentsFor(['--control','--candidate','--control-version','--candidate-version','--output']);
for(const key of ['--control','--candidate','--control-version','--candidate-version','--output'])assert(args[key]);
const manifest=await loadManifest('fixtures/seeds/performance-v1.json'),contents={};
for(const version of ['control','candidate']){
  const source=JSON.parse(await readFile(args[`--${version}`],'utf8'));for(const c of source.characters)c.stats.maxHp=1000;
  contents[version]=compilePhase3BContent(source);
}
function run(item,version){const content=contents[version],r=new UtilityRunner(content,fighterConfig(content,item.seed,item.a,item.b,2700),{recordFrames:false,trace:false});
  assert.equal(r.aiVersion,args[`--${version}-version`]);const cpu=process.cpuUsage(),start=performance.now(),replay=r.run(),wallMs=performance.now()-start,used=process.cpuUsage(cpu);
  assert.equal(replay.inputs.length,2700);assert.equal(replay.result.reason,'timeout');return{caseId:item.caseId,version,ticks:2700,wallMs,cpuMs:(used.user+used.system)/1000,rss:process.memoryUsage().rss};}
for(const item of manifest.cases.slice(0,10))for(const version of ['control','candidate'])run(item,version);
const rows=[];console.log('Warmed 10 matches per version');
for(const [i,item]of manifest.cases.slice(10).entries()){
  for(const version of i%2?['candidate','control']:['control','candidate'])rows.push(run(item,version));
  if((i+1)%20===0)console.log(`Benchmark ${i+1}/100 pairs`);
}
const summary={};for(const version of ['control','candidate']){const r=rows.filter(r=>r.version===version),ms=r.reduce((s,r)=>s+r.wallMs,0);
  summary[version]={matches:r.length,ticks:r.length*2700,wallSeconds:ms/1000,totalProcessCpuSeconds:r.reduce((s,r)=>s+r.cpuMs,0)/1000,
    realtimeMultiple:r.length*45/(ms/1000),medianMs:quantile(r.map(r=>r.wallMs),.5),p95Ms:quantile(r.map(r=>r.wallMs),.95),maxSampledRssMiB:Math.max(...r.map(r=>r.rss))/1048576};}
const report={passed:summary.candidate.wallSeconds/summary.control.wallSeconds<=1.1&&summary.candidate.realtimeMultiple>=20,
  args,node:process.version,cpu:cpus()[0].model,os:release(),manifestHash:manifest.datasetHash,
  contentHashes:Object.fromEntries(Object.entries(contents).map(([k,c])=>[k,c.bundleHash])),
  measurement:'Sequential alternating pairs; 10 warmup + 100 measured per version; fixed 2700 ticks with fixture-only HP=1000; off/trace=false/frames=false; CPU is whole process.',
  relativeWallGrowth:summary.candidate.wallSeconds/summary.control.wallSeconds-1,summary,rows};
await mkdir(args['--output'],{recursive:true});await writeFile(`${args['--output']}/benchmark.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({...report,rows:undefined}));if(!report.passed)process.exitCode=1;
