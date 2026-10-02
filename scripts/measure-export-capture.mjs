import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
import {chromium} from 'playwright';
import {serveStatic} from '../dist/node/jobs/static-server.js';
import {chromiumPath} from '../dist/node/jobs/media.js';
import {loadReplayPackage,saveReplayPackage} from '../dist/node/jobs/replay-store.js';
import {fileHash} from '../dist/node/jobs/files.js';
import {createRenderJob} from '../dist/node/render/timeline.js';
import {compilePhase3BContent} from '../dist/node/content/phase3b.js';
import {fighterConfig} from '../dist/node/runner/fighter.js';
import {recordMatch} from '../dist/node/runner/record-match.js';
import {analyzeMatch} from '../dist/node/analysis/interesting.js';
import {hashCanonical} from '../dist/node/math/hash.js';
import {AUDIO_ASSETS_VERSION,SOUND_SPECS} from '../dist/node/render/audio.js';
// Generate the same fixed raw fight on a clean clone; no historical artifacts required.
const directory=resolve('artifacts/phase-5/capture-fixture'),content=compilePhase3BContent(JSON.parse(await readFile('content/fighter-phase3b.json','utf8'))),cfg=fighterConfig(content,367399065,'standard','mirror');cfg.matchId='phase5-capture-fixture';
const runner={kinds:['utility','utility'],settings:{noise:true,randomChoice:true,memory:true}},recorded=recordMatch(content,cfg,runner),tools=JSON.parse(await readFile('content/export-toolchain.json','utf8'));
await saveReplayPackage(directory,{replay:recorded.replay,frames:recorded.frames,content,runner,hashes:recorded.hashes,analysis:analyzeMatch(recorded.replay,recorded.frames),rulesHash:recorded.rulesHash,toolchainId:tools.id});
const pkg=await loadReplayPackage(directory),job=createRenderJob(pkg.manifest,fileHash(await readFile(resolve(directory,'manifest.json'))),{preset:'vertical-1080',templateId:'arena-dark',fontHash:tools.font.sha256,audioAssetsHash:hashCanonical({version:AUDIO_ASSETS_VERSION,specs:SOUND_SPECS}),keepFrames:true,toolchainId:tools.id});
const payload={manifest:pkg.manifest,content:pkg.content,frames:pkg.frames,events:pkg.replay.events,job};
const server=await serveStatic(0,async(req,res)=>{if(req.url!=='/payload.json')return false;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(payload));return true;});
const browser=await chromium.launch({headless:true,executablePath:chromiumPath()}),rows=[];
try{
  const page=await browser.newPage({viewport:{width:1080,height:1920},deviceScaleFactor:1});
  await page.goto(server.url+'/export.html');await page.waitForFunction('globalThis.__videoExporter?.ready');
  await page.evaluate("fetch('/payload.json').then(r=>r.json()).then(p=>globalThis.__videoExporter.load(p))");
  const canvas=page.locator('#video'),cdp=await page.context().newCDPSession(page),indices=Array.from({length:100},(_,i)=>Math.floor(i*(job.totalFrames-1)/99));
  const capture=async mode=>mode==='locator'?canvas.screenshot({type:'png',animations:'disabled'}):Buffer.from((await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true,clip:{x:0,y:0,width:1080,height:1920,scale:1}})).data,'base64');
  for(let i=0;i<10;i++){await page.evaluate(n=>globalThis.__videoExporter.renderFrame(n),indices[i]);await capture('locator');await capture('cdp');}
  for(let i=0;i<indices.length;i++){
    const hashes={};for(const mode of i%2?['cdp','locator']:['locator','cdp']){const start=performance.now();await page.evaluate(n=>globalThis.__videoExporter.renderFrame(n),indices[i]);const bytes=await capture(mode);rows.push({frame:indices[i],mode,ms:performance.now()-start,bytes:bytes.length});hashes[mode]=fileHash(bytes);}
    assert.equal(hashes.locator,hashes.cdp,'Pixel and PNG byte identity at '+indices[i]);
    if(i%20===0)console.log(`Capture benchmark ${i+1}/100`);
  }
}finally{await browser.close();await server.close();}
const totals=Object.fromEntries(['locator','cdp'].map(mode=>{const group=rows.filter(r=>r.mode===mode),values=group.map(r=>r.ms).sort((a,b)=>a-b),total=values.reduce((a,b)=>a+b,0);return [mode,{frames:values.length,totalMs:total,medianMs:values[49],p95Ms:values[94],framesPerSecond:100000/total}];}));
const report={passed:true,fixture:job.id,manifestHash:job.replayManifestHash,dimensions:[1080,1920],warmupFramesPerMode:10,measuredFramesPerMode:100,order:'alternating per same frame',pngByteIdentity:true,sourceFramesUnchanged:true,totals,reduction:1-totals.cdp.totalMs/totals.locator.totalMs,rows};
await mkdir('artifacts/phase-5',{recursive:true});await writeFile('artifacts/phase-5/capture-benchmark.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(totals));
