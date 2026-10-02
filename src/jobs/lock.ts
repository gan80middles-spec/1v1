import { open, readFile, unlink, mkdir, rmdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { containedPath } from './files.js';
function alive(pid:number):boolean {try{process.kill(pid,0);return true;}catch(error){return (error as NodeJS.ErrnoException).code!=='ESRCH';}}
export async function acquireJobLock(directory:string):Promise<()=>Promise<void>> {
  await mkdir(directory,{recursive:true});const path=containedPath(directory,'.job.lock'),mutex=containedPath(directory,'.lock-recovery'),token=randomUUID();
  const claim=async()=>{const file=await open(path,'wx');try{await file.writeFile(JSON.stringify({pid:process.pid,token,createdAt:new Date().toISOString()}));await file.sync();}finally{await file.close();}};
  try{await claim();}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;
    // A separate atomic directory prevents two parents from racing to remove a stale lock.
    try{await mkdir(mutex);}catch{throw new Error('LOCK_RECOVERY_BUSY');}
    try{const bytes=await readFile(path,'utf8');let saved:{pid:number;token:string};try{saved=JSON.parse(bytes) as typeof saved;}catch{throw new Error('LOCK_CORRUPT: inspect the saved lock before recovery');}
      if(!Number.isInteger(saved.pid)||saved.pid<=0||typeof saved.token!=='string')throw new Error('LOCK_CORRUPT');if(alive(saved.pid))throw new Error('JOB_LOCKED by process '+saved.pid);
      if(await readFile(path,'utf8')!==bytes)throw new Error('LOCK_CHANGED');await unlink(path);await claim();
    }finally{await rmdir(mutex);}}
  return async()=>{const saved=JSON.parse(await readFile(path,'utf8')) as {token:string};if(saved.token!==token)throw new Error('LOCK_OWNER_CHANGED');await unlink(resolve(directory,'.job.lock'));};
}
