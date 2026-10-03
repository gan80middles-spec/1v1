import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,relative,extname} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {UtilityRunner} from '../dist/node/runner/utility.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {recordMatch} from '../dist/node/runner/record-match.js';
import {loadReplayPackage,saveReplayPackage} from '../dist/node/jobs/replay-store.js';
import {analyzeMatch} from '../dist/node/analysis/interesting.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {chromiumPath} from '../dist/node/jobs/media.js';
import {argumentsFor} from './optimization-common.mjs';
const args=argumentsFor(['--content','--version','--batch','--output']);
for(const key of ['--content','--version','--batch','--output'])assert(args[key]);
const directory=resolve(args['--output']);await mkdir(directory,{recursive:true});
const content=compilePhase3BContent(JSON.parse(await readFile(args['--content'],'utf8'))),batch=JSON.parse(await readFile(resolve(args['--batch'],'batch.json'),'utf8'));
assert.equal(batch.aiVersion,args['--version']);const production=[];
for(const task of batch.tasks){
  const pkg=await loadReplayPackage(resolve(args['--batch'],'matches',task.matchId));assert.equal(pkg.manifest.aiVersion,args['--version']);assert.equal(pkg.manifest.contentHash,content.bundleHash);
  const runner=new UtilityRunner(content,pkg.manifest.config,{...pkg.manifest.runner,recordFrames:false});
  assert.deepEqual(runner.run().inputs,pkg.replay.inputs);assert.equal(runner.runnerHash(),pkg.manifest.finalRunnerHash);
  production.push({matchId:task.matchId,runnerHash:runner.runnerHash()});
}
const options={kinds:['utility','utility'],settings:{noise:true,randomChoice:true,memory:true}};let restores=0,futureInputs=0;
for(const mode of ['off','observe','pace']){
  const cfg=fighterConfig(content,17,'mirror','rubber',720);cfg.pacing={mode,profileId:mode==='off'?null:'gentle-v1'};
  const data=recordMatch(content,cfg,options,true),dir=resolve(directory,'packages',mode);
  await saveReplayPackage(dir,{...data,content,runner:options,analysis:analyzeMatch(data.replay,data.frames,{replayVerified:true,filesComplete:true}),toolchainId:batch.toolchainId});
  const pkg=await loadReplayPackage(dir);
  for(const cp of pkg.checkpoints){if(cp.nextTick===pkg.manifest.durationTicks)continue;const r=new UtilityRunner(content,cfg,{recordFrames:false});r.restore(cp);
    while(!r.sim.snapshot().result){r.step();assert.deepEqual(r.inputs.at(-1),pkg.replay.inputs[r.sim.snapshot().tick-1]);futureInputs++;}assert.equal(r.runnerHash(),pkg.manifest.finalRunnerHash);restores++;}
}
const root=resolve('dist/web'),server=createServer(async(req,res)=>{try{
  const url=new URL(req.url??'/','http://127.0.0.1'),path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));
  if(relative(root,path).startsWith('..')){res.writeHead(403).end();return;}
  res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'}[extname(path)]??'application/octet-stream'}).end(await readFile(path));
}catch{res.writeHead(404).end();}});await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true,executablePath:chromiumPath()}),errors=[],web=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(e.message));
  for(const mode of ['off','observe','pace']){
    await page.goto(`http://127.0.0.1:${server.address().port}/?ai=${args['--version']}&a=mirror&b=rubber&seed=17&pacing=${mode}`);
    assert.equal(await page.locator('#ai-version').inputValue(),args['--version']);await page.locator('#finish').click();
    const cfg=fighterConfig(content,17,'mirror','rubber');cfg.pacing={mode,profileId:mode==='off'?null:'gentle-v1'};cfg.matchId+=`-${mode}-1`;
    const r=new UtilityRunner(content,cfg,{trace:true}),replay=r.run();assert.equal(await page.locator('#output').getAttribute('data-final-hash'),replay.finalWorldHash);
    const downloaded=page.waitForEvent('download');await page.locator('#export-trace').click();const path=resolve(directory,`browser-${mode}.trace.json`);await(await downloaded).saveAs(path);
    assert.equal(hashCanonical(JSON.parse(await readFile(path,'utf8')).traces),hashCanonical(r.traces));web.push({mode,inputHash:hashCanonical(replay.inputs),worldHash:replay.finalWorldHash});
  }
  for(const version of ['utility-v3','utility-v4']){
    await page.locator('#ai-version').selectOption(version);assert.equal(await page.locator('#output').getAttribute('data-tick'),'0');
    await page.locator('#pacing').selectOption('off');await page.locator('#finish').click();
    const downloaded=page.waitForEvent('download');await page.locator('#export-trace').click();const path=resolve(directory,`browser-${version}.trace.json`);await(await downloaded).saveAs(path);
    assert(JSON.parse(await readFile(path,'utf8')).traces.every(t=>t.trace.aiVersion===version));
  }
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(done=>server.close(done));}
const report={passed:true,aiVersion:args['--version'],contentHash:content.bundleHash,workerMatchesCompared:production.length,production,
  serializedPackageRestores:restores,futureInputs,web,nodeChromiumTracesEqual:true,legacySelectors:true,mobileNoOverflow:true,errors};
await writeFile(resolve(directory,'integration.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,production:undefined}));
