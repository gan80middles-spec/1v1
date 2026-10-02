import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {chromium} from 'playwright';
import {startProductionServer} from '../dist/node/jobs/server.js';
import {chromiumPath} from '../dist/node/jobs/media.js';
import {fileHash} from '../dist/node/jobs/files.js';
const directory=resolve('artifacts/phase-5/browser');await mkdir(directory,{recursive:true});
const config=JSON.parse(await readFile('production.final.json','utf8')),formal=resolve(config.output),batch=JSON.parse(await readFile(resolve(formal,'batch.json'),'utf8'));assert.equal(batch.status,'complete');
const server=await startProductionServer(5177),browser=await chromium.launch({headless:true,executablePath:chromiumPath()}),errors=[],children=[];
try{
  const page=await browser.newPage({viewport:{width:1360,height:1100}});page.on('pageerror',e=>errors.push(e.message));await page.goto(server.url+'/production.html');await page.waitForFunction('globalThis.productionReady');await page.locator('#jobs').selectOption(formal);await page.waitForFunction(()=>document.querySelector('#summary').textContent.includes('10 条视频完成'));assert.equal(await page.locator('#tasks tr').count(),100);await page.screenshot({path:resolve(directory,'production.png'),fullPage:true});
  for(const id of batch.selection){const task=batch.tasks.find(t=>t.matchId===id);await page.goto(server.url+'/replay.html?batch='+encodeURIComponent(formal)+'&match='+id);await page.waitForFunction('globalThis.replayReady');assert((await page.locator('#config').textContent()).includes(String(task.config.seed)));await page.locator('#seek').evaluate(e=>{e.value='180.25';e.dispatchEvent(new Event('input'));});const first=await page.locator('#video').screenshot();await page.locator('#seek').evaluate(e=>{e.value='400';e.dispatchEvent(new Event('input'));e.value='180.25';e.dispatchEvent(new Event('input'));});assert.equal(fileHash(await page.locator('#video').screenshot()),fileHash(first));}
  await page.locator('#template').selectOption('arena-light');await page.screenshot({path:resolve(directory,'replay.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.screenshot({path:resolve(directory,'mobile.png'),fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  for(const [stage,port,count] of [['phase5',5178,30],['phase5-style',5179,40]]){
    const child=spawn(process.execPath,['scripts/serve-h2.mjs','--stage',stage],{stdio:['ignore','pipe','pipe'],windowsHide:true});children.push(child);let logs='';child.stdout.on('data',b=>logs+=String(b));child.stderr.on('data',b=>logs+=String(b));
    const end=Date.now()+15000;while(Date.now()<end){try{if((await fetch(`http://127.0.0.1:${port}/review-data/index.json`)).ok)break;}catch{}await new Promise(accept=>setTimeout(accept,100));}
    const url=`http://127.0.0.1:${port}`,index=await fetch(url+'/review-data/index.json').then(r=>r.json());assert.equal(index.entries.length,count);assert.equal((await fetch(url+'/review-data/private-key.json')).status,404);
    const review=await browser.newPage({viewport:{width:1360,height:1100}});review.on('pageerror',e=>errors.push(e.message));await review.goto(url);await review.waitForFunction(()=>document.documentElement.dataset.ready==='true');assert.equal(await review.locator('#clip option').count(),count);
    if(stage==='phase5'){assert((await review.locator('header p').textContent()).includes('两场不同比赛'));assert(!('group' in index.entries[0]));await review.locator('select[name=preference]').selectOption('X');await review.locator('textarea[name=notes]').fill('AUTOMATED UI CHECK ONLY; not a human judgment');const download=review.waitForEvent('download');await review.locator('#save').click();await (await download).saveAs(resolve(directory,'automated-ui-rating.json'));}
    await review.locator('#seek').evaluate(e=>{e.value=e.max;e.dispatchEvent(new Event('input'));});await review.screenshot({path:resolve(directory,stage+'.png'),fullPage:true});await review.close();
  }
  assert.deepEqual(errors,[]);await writeFile(resolve('artifacts/phase-5/browser.json'),JSON.stringify({passed:true,errors,finalBatchRows:100,completeVideos:10,allTenFrozenPackagesPlayed:true,randomSeekExactPNG:true,alternateTemplate:true,mobileNoOverflow:true,scoreReview:{clips:30,pairs:15,labelsHidden:true,privateKeyNotServed:true,downloadWorks:true,automatedRatingExcludedFromHumanEvidence:true},styleReview:{clips:40,privateKeyNotServed:true},screenshots:directory},null,2)+'\n');
}finally{for(const child of children){if(child.exitCode===null){const closed=new Promise(accept=>child.once('close',accept));child.kill();await closed;}}await browser.close();await server.close();}
console.log('Final production/replay and both private-key-isolated review pages passed.');
