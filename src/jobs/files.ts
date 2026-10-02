import { open, mkdir, rename, readFile, unlink, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalSerialize } from '../math/canonical.js';
let serial=0;
export const fileHash=(bytes:Uint8Array):string=>createHash('sha256').update(bytes).digest('hex');
export function containedPath(root:string,path:string):string {const full=resolve(root,path),part=relative(resolve(root),full);if(part.startsWith('..')||isAbsolute(part))throw new Error('PATH_OUTSIDE_JOB');return full;}
export async function safeRead(root:string,path:string):Promise<Buffer> {const full=containedPath(root,path),[actualRoot,actual]=await Promise.all([realpath(root),realpath(full)]);containedPath(actualRoot,relative(actualRoot,actual));const size=(await stat(actual)).size;if(size>1_000_000_000)throw new Error('FILE_BUDGET_EXCEEDED');return readFile(actual);}
export async function atomicWrite(path:string,bytes:Uint8Array|string):Promise<void> {
  await mkdir(dirname(path),{recursive:true});const temporary=path+`.tmp-${process.pid}-${serial++}`;let handle;
  try{handle=await open(temporary,'wx');await handle.writeFile(bytes);await handle.sync();await handle.close();handle=undefined;await rename(temporary,path);}
  finally{await handle?.close();await unlink(temporary).catch(error=>{if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;});}
}
export const atomicJSON=(path:string,value:unknown):Promise<void>=>atomicWrite(path,canonicalSerialize(value)+'\n');
export async function readJSON(path:string):Promise<unknown>{return JSON.parse(await readFile(path,'utf8'));}
