import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import {atomicWrite,containedPath,readJSON} from '../src/jobs/files.js';
import {openBatch,failure} from '../src/jobs/batch.js';
import {FrameIndexSchema} from '../src/contracts/production.js';
async function directory(){const root=resolve('artifacts/phase-4/unit-io');await mkdir(root,{recursive:true});return mkdtemp(resolve(root,'case-'));}
describe('production persistence validation',()=>{
  it('same-volume atomic replace leaves the exact completed bytes',async()=>{const dir=await directory(),path=resolve(dir,'record.txt');await atomicWrite(path,'original');await atomicWrite(path,'completed replacement');expect(await readFile(path,'utf8')).toBe('completed replacement');});
  it.each(['../outside','C:/outside'])('rejects a contained-path escape %s',path=>{expect(()=>containedPath(resolve('artifacts'),path)).toThrow('PATH_OUTSIDE_JOB');});
  it('an interrupted temporary file never becomes a committed batch',async()=>{const dir=await directory();await writeFile(resolve(dir,'batch.json.tmp'),'partial bytes');const input={schemaVersion:1,id:'io-fixture',output:dir,seed:1,matchups:[{a:'iron',b:'iron'}],countPerMatchup:1,workers:1,top:1,pacing:'off',preset:'vertical-720',templateId:'arena-dark',keepFrames:true,fullCheckpoints:true,maxTicks:3600},opened=await openBatch(input);try{expect(opened.context.batch.tasks[0]!.state).toBe('pending');await failure(opened.context,opened.context.batch.tasks[0]!,'simulating',new Error('DRIFT at 240'));const record=await readJSON(resolve(dir,opened.context.batch.tasks[0]!.failures[0]!.diagnosticPath)) as {errorTick:string;contentSnapshot:unknown;inputLogPath:null};expect(record.errorTick).toBe('240');expect(record.contentSnapshot).not.toBeNull();expect(record.inputLogPath).toBeNull();}finally{await opened.release();}});
  it('strict frame indices reject extra fields, nonfinite counts and malformed hashes',()=>{const valid={schemaVersion:1,jobId:'export-fixture',frameCount:1,hashes:['a'.repeat(64)],cleaned:false};expect(FrameIndexSchema.safeParse(valid).success).toBe(true);expect(FrameIndexSchema.safeParse({...valid,hashes:['bad']}).success).toBe(false);expect(FrameIndexSchema.safeParse({...valid,frameCount:Infinity}).success).toBe(false);expect(FrameIndexSchema.safeParse({...valid,extra:true}).success).toBe(false);});
});
