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
const directory=resolve('artifacts/calibration/verification');await mkdir(directory,{recursive:true});
const source=JSON.parse(await readFile('content/fighter-calibrated.json','utf8')),content=compilePhase3BContent(source);
const batch=JSON.parse(await readFile('artifacts/calibrated-production/batch.json','utf8'));
assert.equal(batch.aiVersion,'utility-v4');const production=[];
for(const task of batch.tasks){
  const pkg=await loadReplayPackage(resolve('artifacts/calibrated-production/matches',task.matchId));
  assert.equal(pkg.manifest.aiVersion,'utility-v4');assert.equal(pkg.manifest.contentHash,content.bundleHash);
  const runner=new UtilityRunner(content,pkg.manifest.config,{...pkg.manifest.runner,recordFrames:false});
  assert.deepEqual(runner.run().inputs,pkg.replay.inputs);assert.equal(runner.runnerHash(),pkg.manifest.finalRunnerHash);
  production.push({matchId:task.matchId,runnerHash:runner.runnerHash()});
}
const runnerOptions={kinds:['utility','utility'],settings:{noise:true,randomChoice:true,memory:true}};
let restores=0,futureInputs=0;
for(const mode of ['off','observe','pace']){
  const config=fighterConfig(content,17,'mirror','rubber',720);config.pacing={mode,profileId:mode==='off'?null:'gentle-v1'};
  const data=recordMatch(content,config,runnerOptions,true),dir=resolve(directory,'packages',mode);
  const analysis=analyzeMatch(data.replay,data.frames,{replayVerified:true,filesComplete:true});
  await saveReplayPackage(dir,{...data,content,runner:runnerOptions,analysis,toolchainId:batch.toolchainId});
  const pkg=await loadReplayPackage(dir);
  for(const cp of pkg.checkpoints){if(cp.nextTick===pkg.manifest.durationTicks)continue;const runner=new UtilityRunner(content,config,{recordFrames:false});runner.restore(cp);
    while(!runner.sim.snapshot().result){runner.step();assert.deepEqual(runner.inputs.at(-1),pkg.replay.inputs[runner.sim.snapshot().tick-1]);futureInputs++;}
    assert.equal(runner.runnerHash(),pkg.manifest.finalRunnerHash);restores++;
  }
}
const root=resolve('dist/web');
const server=createServer(async(req,res)=>{try{const url=new URL(req.url??'/','http://127.0.0.1'),path=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname));if(relative(root,path).startsWith('..')){res.writeHead(403).end();return;}res.writeHead(200,{'Content-Type':{'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css'}[extname(path)]??'application/octet-stream'}).end(await readFile(path));}catch{res.writeHead(404).end();}});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const browser=await chromium.launch({headless:true,executablePath:chromiumPath()}),errors=[],web=[];
try{
  const page=await browser.newPage({viewport:{width:1440,height:1100}});page.on('pageerror',e=>errors.push(e.message));
  const base=`http://127.0.0.1:${server.address().port}`;
  for(const mode of ['off','observe','pace']){
    await page.goto(`${base}/?ai=utility-v4&a=mirror&b=rubber&seed=17&pacing=${mode}`);
    assert.equal(await page.locator('#ai-version').inputValue(),'utility-v4');await page.locator('#finish').click();
    const cfg=fighterConfig(content,17,'mirror','rubber');cfg.pacing={mode,profileId:mode==='off'?null:'gentle-v1'};cfg.matchId+=`-${mode}-1`;
    const runner=new UtilityRunner(content,cfg,{trace:true}),replay=runner.run();
    assert.equal(await page.locator('#output').getAttribute('data-final-hash'),replay.finalWorldHash);
    const downloaded=page.waitForEvent('download');await page.locator('#export-trace').click();const path=resolve(directory,`browser-${mode}.trace.json`);await(await downloaded).saveAs(path);
    // Downloads use canonical JSON, which intentionally normalizes JavaScript -0 to 0.
    assert.equal(hashCanonical(JSON.parse(await readFile(path,'utf8')).traces),hashCanonical(runner.traces));
    web.push({mode,inputHash:hashCanonical(replay.inputs),worldHash:replay.finalWorldHash});
  }
  await page.screenshot({path:resolve(directory,'calibrated-web.png'),fullPage:true});
  await page.locator('#ai-version').selectOption('utility-v3');assert.equal(await page.locator('#output').getAttribute('data-tick'),'0');
  await page.locator('#pacing').selectOption('off');await page.locator('#finish').click();
  const downloaded=page.waitForEvent('download');await page.locator('#export-trace').click();const path=resolve(directory,'browser-legacy.trace.json');await(await downloaded).saveAs(path);
  assert(JSON.parse(await readFile(path,'utf8')).traces.every(t=>t.trace.aiVersion==='utility-v3'));
  await page.setViewportSize({width:390,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.deepEqual(errors,[]);
}finally{await browser.close();await new Promise(done=>server.close(done));}
const report={passed:true,contentHash:content.bundleHash,workerMatchesCompared:production.length,production,serializedPackageRestores:restores,futureInputs,web,nodeChromiumTracesEqual:true,legacySelector:true,mobileNoOverflow:true,errors};
await writeFile(resolve(directory,'integration.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,production:undefined}));
