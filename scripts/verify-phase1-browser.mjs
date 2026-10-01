import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve,extname,relative} from 'node:path';
import {createServer} from 'node:http';
import {compileFighterContent} from '../dist/node/content/fighter.js';
import {FighterRunner,fighterConfig} from '../dist/node/runner/fighter.js';
process.env.PLAYWRIGHT_BROWSERS_PATH=resolve('.cache/ms-playwright');
const {chromium}=await import('playwright'),webRoot=resolve('dist/web'),directory=resolve('artifacts/phase-1');await mkdir(directory,{recursive:true});
const server=createServer(async(request,response)=>{try{const url=new URL(request.url??'/','http://127.0.0.1'),path=resolve(webRoot,`.${decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname)}`),local=relative(webRoot,path);if(local.startsWith('..')||local.includes(':')){response.writeHead(403).end();return;}const bytes=await readFile(path),mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.ttf':'font/ttf'}[extname(path)]??'application/octet-stream';response.writeHead(200,{'Content-Type':mime});response.end(bytes);}catch{response.writeHead(404).end();}});
await new Promise((accept,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',accept);});
const browser=await chromium.launch({headless:true}),errors=[];
try{
 const page=await browser.newPage({viewport:{width:1280,height:1180},deviceScaleFactor:1});page.on('pageerror',e=>errors.push(e.message));page.on('requestfailed',r=>errors.push(r.url()));
 await page.goto(`http://127.0.0.1:${server.address().port}/?controller-a=rush&controller-b=ranged`,{waitUntil:'networkidle'});await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 const tick=async()=>Number(await page.locator('#output').getAttribute('data-tick'));
 assert.equal(await tick(),0);assert.equal(await page.locator('.fighter-card').count(),2);
 const pixels=await page.locator('#arena').evaluate(node=>{const c=node.getContext('2d');return [[...c.getImageData(240,944,1,1).data],[...c.getImageData(720,944,1,1).data]];});assert.deepEqual(pixels,[[75,145,237,255],[247,167,78,255]]);
 await page.locator('#play').click();await page.waitForFunction(()=>Number(document.querySelector('#output').dataset.tick)>12);await page.locator('#play').click();const paused=await tick();await page.waitForTimeout(120);assert.equal(await tick(),paused);
 await page.locator('#step').click();assert.equal(await tick(),paused+1);await page.locator('#overlay').check();assert.equal(await tick(),paused+1);await page.locator('#speed').selectOption('4');
 const content=compileFighterContent(JSON.parse(await readFile('content/fighter-phase1.json','utf8'))),matching=[];
 for(const seed of [17,18]){
  if(seed===18){await page.locator('#seed').fill('18');await page.getByRole('button',{name:'重置比赛'}).click();}
  const runner=new FighterRunner(content,fighterConfig(content,seed));const replay=runner.run();
  if(seed===17){await page.locator('#play').click();await page.waitForFunction(()=>document.querySelector('#output').dataset.finalHash!=='',{timeout:30000});}else await page.locator('#finish').click();assert.equal(await page.locator('#output').getAttribute('data-final-hash'),replay.finalWorldHash);assert.equal(await tick(),replay.inputs.length);matching.push({seed,finalWorldHash:replay.finalWorldHash,ticks:replay.inputs.length});
  const downloadPromise=page.waitForEvent('download');await page.locator('#export').click();const download=await downloadPromise,path=resolve(directory,`browser-seed-${seed}.json`);await download.saveAs(path);const exported=JSON.parse(await readFile(path,'utf8'));assert.deepEqual(exported,replay);
  await page.locator('#replay').click();await page.locator('#step').click();await page.locator('#seek').evaluate(node=>{node.value='100';node.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await tick(),100);
  const entity=runner.frames[100].entities[0];const pixel=await page.locator('#arena').evaluate((node,p)=>[...node.getContext('2d').getImageData(Math.round(p.x),Math.round(960-p.y+14),1,1).data],entity.position);assert.equal(pixel[3],255);
  await page.locator('#import').setInputFiles(path);await page.waitForFunction(()=>document.querySelector('#message').textContent==='回放校验通过');assert.equal(await tick(),0);await page.locator('#finish').click();assert.equal(await tick(),replay.inputs.length);assert.equal(await page.locator('#output').getAttribute('data-final-hash'),replay.finalWorldHash);
 }
 await page.locator('#seek').evaluate(node=>{node.value='600';node.dispatchEvent(new Event('input',{bubbles:true}));});await page.screenshot({path:resolve(directory,'browser.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'mobile overflow');await page.screenshot({path:resolve(directory,'browser-mobile.png'),fullPage:true});
 const fontCount=await page.evaluate(async()=>{await document.fonts.ready;return (await document.fonts.load('16px EngineProbe','0123456789')).length;});assert.equal(fontCount,1);assert.deepEqual(errors,[]);
 const result={passed:true,browserVersion:browser.version(),nodeBrowserMatching:matching,pauseStable:true,singleStepExact:true,speedOverlayPreserveResult:true,inputExportImportEqual:true,replaySeek:true,mobileNoOverflow:true,fontFacesLoaded:fontCount,pageErrors:errors,screenshot:'artifacts/phase-1/browser.png'};await writeFile(resolve(directory,'browser.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();await new Promise(accept=>server.close(accept));}
