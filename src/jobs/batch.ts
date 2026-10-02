import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { compilePhase3BContent } from '../content/phase3b.js';
import { ProductionConfigSchema, BatchManifestSchema, SCORE_VERSION, type BatchManifest, type BatchTask } from '../contracts/production.js';
import { fighterConfig } from '../runner/fighter.js';
import { UtilityRunner } from '../runner/utility.js';
import { deriveMatchSeed } from '../math/random.js';
import { hashCanonical } from '../math/hash.js';
import { atomicJSON, containedPath, readJSON, fileHash, safeRead } from './files.js';
import { acquireJobLock } from './lock.js';
import { loadReplayPackage } from './replay-store.js';
import { rankMatches } from '../analysis/interesting.js';
export const defaultWorkers=()=>Math.max(1,Math.min(4,availableParallelism()-1));
export const defaultRunner={kinds:['utility','utility'] as ['utility','utility'],settings:{noise:true,randomChoice:true,memory:true}};
export interface JobContext {directory:string;batch:BatchManifest;cancelBuffer:SharedArrayBuffer;cancelled:()=>boolean;save:()=>Promise<void>;fault:'worker-crash'|'simulation'|'rebuilding-track'|'rendering'|'encoding'|'verifying'|null;}
export async function failure(context:JobContext,task:BatchTask,stage:string,error:unknown):Promise<void> {
  const message=error instanceof Error?error.message:String(error),errorCode=message.split(':')[0]!.split(' ')[0]!.slice(0,100)||'UNKNOWN',diagnosticPath=`matches/${task.matchId}/failure-${task.failures.length+1}.json`,record={stage,errorCode,message:message.slice(0,10000),diagnosticPath,seed:task.config.seed,attempt:task.attempts};task.failures.push(record);context.batch.failures.push(record);task.state='failed';await atomicJSON(containedPath(context.directory,diagnosticPath),{...record,config:task.config,contentHash:context.batch.contentHash,engineBuild:context.batch.engineBuild,contentSnapshot:existsSync(resolve(context.directory,'content.json'))?await readJSON(resolve(context.directory,'content.json')):null,inputLogPath:existsSync(resolve(context.directory,'matches',task.matchId,'inputs.ndjson.gz'))?`matches/${task.matchId}/inputs.ndjson.gz`:null,errorTick:message.match(/(?:tick|at)\s+(\d+)/)?.[1]??null,tracePath:null});await context.save();
}
export async function openBatch(input:unknown,options:{resume?:boolean;fault?:JobContext['fault']}={}):Promise<{context:JobContext;release:()=>Promise<void>}> {
  if(process.version!=='v24.21.0')throw new Error('Use the locked Node24.21.0 runtime');const config=ProductionConfigSchema.parse(input),directory=containedPath(resolve('artifacts'),resolve(config.output));
  if(new Set(config.matchups.map(m=>[m.a,m.b].sort().join(':'))).size!==config.matchups.length)throw new Error('Duplicate unordered matchup');
  await mkdir(directory,{recursive:true});const releaseLock=await acquireJobLock(directory);let saveQueue=Promise.resolve();
  try{const content=compilePhase3BContent(await readJSON(resolve('content/fighter-phase3b.json')));let batch:BatchManifest;
    if(existsSync(resolve(directory,'batch.json'))){if(!options.resume)throw new Error('BATCH_EXISTS: use --resume');batch=BatchManifestSchema.parse(await readJSON(resolve(directory,'batch.json')));
      if(hashCanonical({...config,workers:batch.config.workers})!==hashCanonical(batch.config)||batch.contentHash!==content.bundleHash)throw new Error('BATCH_CONFIG_OR_CONTENT_CHANGED');batch.workerCount=config.workers;
      if(batch.rankingHash&&fileHash(await safeRead(directory,'rankings.json'))!==batch.rankingHash)throw new Error('RANKING_HASH_MISMATCH');
      for(const task of batch.tasks){if(['simulating','rebuilding-track','rendering','encoding','verifying'].includes(task.state))task.state=task.lastCompleteState;
        if(task.manifestHash){const dir=resolve(directory,'matches',task.matchId);await loadReplayPackage(dir);const actual=fileHash(await safeRead(dir,'manifest.json'));if(actual!==task.manifestHash){const journal=await readJSON(resolve(dir,'rebuild-journal.json')) as {oldHash:string;newHash:string;matchId:string};if(journal.oldHash!==task.manifestHash||journal.newHash!==actual||journal.matchId!==task.matchId)throw new Error('COMMITTED_MANIFEST_HASH_MISMATCH '+task.matchId);task.manifestHash=actual;}}}
    }else{const tasks=config.matchups.flatMap(matchup=>Array.from({length:config.countPerMatchup},(_,i)=>{const matchupId=[matchup.a,matchup.b].sort().join('-vs-'),seed=deriveMatchSeed(config.seed,matchupId,i),id='match-'+hashCanonical({batchId:config.id,matchupId,sampleIndex:i}).slice(0,24),cfg=fighterConfig(content,seed,matchup.a,matchup.b,config.maxTicks);cfg.matchId=id;cfg.pacing={mode:config.pacing,profileId:config.pacing==='off'?null:'gentle-v1'};return {matchId:id,config:cfg,state:'pending' as const,attempts:0,manifestHash:null,score:null,selectionReason:null,exportId:null,framesComplete:0,totalFrames:0,lastCompleteState:'pending' as const,failures:[]};}));
      const probe=new UtilityRunner(content,tasks[0]!.config,{recordFrames:false}),now=new Date().toISOString();batch=BatchManifestSchema.parse({schemaVersion:1,batchId:config.id,createdAt:now,updatedAt:now,status:'pending',config,engineBuild:'phase3b-v1',aiVersion:'utility-v3',rulesHash:probe.sim.snapshot().rulesHash,contentHash:content.bundleHash,scoreVersion:SCORE_VERSION,toolchainId:'export-win-x64-ffmpeg9.0.2-chromium153-v1',workerCount:config.workers,tasks,selection:[],rankingHash:null,failures:[]});
      await atomicJSON(resolve(directory,'content.json'),content.source);}
    await unlink(resolve(directory,'cancel.request')).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});
    const cancelBuffer=new SharedArrayBuffer(4),cancel=new Int32Array(cancelBuffer),cancelled=()=>Atomics.load(cancel,0)!==0||existsSync(resolve(directory,'cancel.request'));
    const save=()=>{batch.updatedAt=new Date().toISOString();const snapshot=BatchManifestSchema.parse(structuredClone(batch));saveQueue=saveQueue.then(()=>atomicJSON(resolve(directory,'batch.json'),snapshot));return saveQueue;};
    const requestCancel=()=>Atomics.store(cancel,0,1);process.on('SIGINT',requestCancel);process.on('SIGTERM',requestCancel);await save();
    return {context:{directory,batch,cancelBuffer,cancelled,save,fault:options.fault??null},release:async()=>{process.off('SIGINT',requestCancel);process.off('SIGTERM',requestCancel);await saveQueue;await releaseLock();}};
  }catch(error){await releaseLock();throw error;}
}
export async function simulateBatch(context:JobContext):Promise<void> {
  const {batch}=context,pending=batch.tasks.filter(task=>!task.manifestHash&&task.attempts<2),content=await readJSON(resolve(context.directory,'content.json')),workers=new Set<Worker>(),active=new Map<Worker,BatchTask>(),queue=[...pending];let finishing=false,busyCallbacks=0;
  batch.status='running';await context.save();
  const watch=setInterval(()=>{if(context.cancelled())Atomics.store(new Int32Array(context.cancelBuffer),0,1);},100);
  try{await new Promise<void>((resolveDone,reject)=>{
    const done=()=>{if(!busyCallbacks&&!active.size&&(!queue.length||context.cancelled())){finishing=true;resolveDone();}};
    const dispatch=async(worker:Worker)=>{if(finishing||context.cancelled()){done();return;}if(!workers.has(worker)){if(queue.length)create();done();return;}const task=queue.shift();if(!task){done();return;}task.state='simulating';task.attempts++;active.set(worker,task);await context.save();
      worker.postMessage({matchId:task.matchId,config:task.config,directory:resolve(context.directory,'matches',task.matchId),runner:defaultRunner,crash:context.fault==='worker-crash'&&task===pending[0]&&task.attempts===1,fail:context.fault==='simulation'&&task===pending[0]});};
    const completed=async(worker:Worker,result:{matchId:string;ok:boolean;manifestHash?:string;score?:number;error?:string})=>{busyCallbacks++;try{const task=active.get(worker);if(!task||result.matchId!==task.matchId)throw new Error('WORKER_RESULT_IDENTITY_MISMATCH');active.delete(worker);
      if(result.ok){task.manifestHash=result.manifestHash!;task.score=result.score!;task.state='simulated';task.lastCompleteState='simulated';await context.save();console.log(`Simulated ${batch.tasks.filter(t=>t.manifestHash).length}/${batch.tasks.length}: ${task.matchId} seed=${task.config.seed}`);}
      else if(result.error==='CANCELLED'){task.attempts--;task.state='pending';await context.save();}
      else{await failure(context,task,'simulating',new Error(result.error??'WORKER_FAILED'));if(task.attempts<2&&!context.cancelled())queue.unshift(task);}
      await dispatch(worker);}finally{busyCallbacks--;done();}};
    const create=()=>{const worker=new Worker(new URL('./worker.js',import.meta.url),{workerData:{content,cancelBuffer:context.cancelBuffer,toolchainId:batch.toolchainId}});workers.add(worker);
      worker.on('message',result=>void completed(worker,result as Parameters<typeof completed>[1]).catch(reject));worker.on('error',()=>{});
      worker.on('exit',code=>{workers.delete(worker);if(finishing)return;const task=active.get(worker);if(task){active.delete(worker);busyCallbacks++;void (async()=>{try{await failure(context,task,'simulating',new Error('WORKER_EXIT_'+code));if(task.attempts<2&&!context.cancelled())queue.unshift(task);if(queue.length&&!context.cancelled())create();}finally{busyCallbacks--;done();}})().catch(reject);}else done();});
      void dispatch(worker).catch(reject);};
    if(!queue.length){finishing=true;resolveDone();return;}for(let i=0;i<Math.min(batch.workerCount,pending.length);i++)create();
  });}finally{clearInterval(watch);finishing=true;await Promise.all([...workers].map(w=>w.terminate()));}
  batch.status=context.cancelled()?'cancelled':batch.tasks.some(t=>!t.manifestHash)?'failed':'simulated';await context.save();
}
export async function rankBatch(context:JobContext):Promise<ReturnType<typeof rankMatches>> {
  const analyses=[];for(const task of context.batch.tasks)if(task.manifestHash){const pkg=await loadReplayPackage(resolve(context.directory,'matches',task.matchId));analyses.push(pkg.analysis);}
  const rankings=rankMatches(analyses,context.batch.config.top);await atomicJSON(resolve(context.directory,'rankings.json'),rankings);context.batch.rankingHash=fileHash(await safeRead(context.directory,'rankings.json'));context.batch.selection=rankings.selected;
  for(const task of context.batch.tasks)if(task.manifestHash&&task.state!=='complete'){task.state='ranked';task.lastCompleteState='ranked';}await context.save();
  for(const task of context.batch.tasks){const row=rankings.rows.find(r=>r.matchId===task.matchId);if(!row)continue;task.score=row.score;task.selectionReason=row.reason;if(task.state!=='complete'){task.state=row.selected?'selected':'not-selected';task.lastCompleteState=task.state;}}
  context.batch.status='ranked';await context.save();return rankings;
}
