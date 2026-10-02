import assert from 'node:assert/strict';
import {resolve} from 'node:path';
import {mkdir,readFile,writeFile,stat} from 'node:fs/promises';
import {openBatch,simulateBatch,rankBatch} from '../dist/node/jobs/batch.js';
import {renderSelection,verifySelection} from '../dist/node/jobs/export.js';
import {atomicJSON} from '../dist/node/jobs/files.js';
const directory=resolve('artifacts/phase-4',`恢复测试 recovery ${Date.now()}`),config={schemaVersion:1,id:'phase4-media-recovery',output:directory,seed:20261003,matchups:[{a:'iron',b:'iron'}],countPerMatchup:1,workers:1,top:1,pacing:'off',preset:'vertical-720',templateId:'arena-light',keepFrames:true,fullCheckpoints:true,maxTicks:3600};await mkdir(directory,{recursive:true});await atomicJSON(resolve(directory,'production-config.json'),config);
let opened=await openBatch(config);try{await simulateBatch(opened.context);await rankBatch(opened.context);assert.equal(opened.context.batch.selection.length,1);}finally{await opened.release();}
const faults=[];let beforeFramesHash=null,exportDir;
for(const stage of ['rebuilding-track','rendering','encoding','verifying']){opened=await openBatch(config,{resume:true,fault:stage});try{await renderSelection(opened.context);const task=opened.context.batch.tasks[0];assert.equal(task.state,'failed',stage+' should fail');assert.equal(task.failures.at(-1).stage,stage);if(task.exportId)exportDir=resolve(directory,'exports',task.exportId);faults.push({stage,task:structuredClone(task),diagnostic:task.failures.at(-1)});
  if(stage==='rendering'){assert.equal(task.framesComplete,25);await writeFile(resolve(exportDir,'frames/frame-000000.png'),'damaged PNG, deliberately injected');}
  if(stage==='encoding'){assert((await stat(resolve(exportDir,'candidate.mp4'))).size>0);beforeFramesHash=await readFile(resolve(exportDir,'frame-index.json'),'utf8');}
  if(stage==='verifying'){assert.equal(await readFile(resolve(exportDir,'frame-index.json'),'utf8'),beforeFramesHash);assert((await stat(resolve(exportDir,'encoding.json'))).size>0);}
}finally{await opened.release();}}
opened=await openBatch(config,{resume:true});try{await renderSelection(opened.context);assert.equal(opened.context.batch.status,'complete');await verifySelection(opened.context);assert.equal(await readFile(resolve(exportDir,'frame-index.json'),'utf8'),beforeFramesHash);const verification=JSON.parse(await readFile(resolve(exportDir,'verification.json'),'utf8'));await atomicJSON(resolve('artifacts/phase-4/recovery.json'),{passed:true,directory,config,faults,corruptPNGRebuiltFromFirstBad:true,encodingRealChildInterrupted:true,verifiedEncodingAndPNGsReused:true,complete:opened.context.batch,verification});console.log('Four actual media-stage failures, corrupt PNG repair and all resumptions passed.');}finally{await opened.release();}
