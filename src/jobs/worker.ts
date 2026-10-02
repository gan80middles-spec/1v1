import { parentPort, workerData } from 'node:worker_threads';
import { resolve } from 'node:path';
import { compilePhase3BContent } from '../content/phase3b.js';
import { FighterConfigSchema } from '../contracts/fighter-schema.js';
import { RunnerRecordingSchema, type ReplayManifest } from '../contracts/production.js';
import { recordMatch } from '../runner/record-match.js';
import { replayInputs } from '../runner/input-replay.js';
import { analyzeMatch } from '../analysis/interesting.js';
import { saveReplayPackage } from './replay-store.js';
import { fileHash, safeRead } from './files.js';
import { hashCanonical } from '../math/hash.js';
const setup=workerData as {content:unknown;cancelBuffer:SharedArrayBuffer;toolchainId:string},content=compilePhase3BContent(setup.content),cancel=new Int32Array(setup.cancelBuffer);
if(!parentPort)throw new Error('Simulation worker requires parentPort');
parentPort.on('message',async(message:unknown)=>{
  const task=message as {matchId:string;config:unknown;directory:string;runner:ReplayManifest['runner'];crash:boolean;fail:boolean};
  try{if(task.crash)process.exit(17);if(task.fail)throw new Error('INJECTED_SIMULATION_FAILURE');
    const config=FighterConfigSchema.parse(task.config),runner=RunnerRecordingSchema.parse(task.runner);if(config.matchId!==task.matchId)throw new Error('WORKER_IDENTITY_MISMATCH');
    const recorded=recordMatch(content,config,runner,false,()=>Atomics.load(cancel,0)!==0);replayInputs(recorded.replay,false);
    const analysis=analyzeMatch(recorded.replay,recorded.frames,{replayVerified:true,filesComplete:true});
    await saveReplayPackage(task.directory,{replay:recorded.replay,hashes:recorded.hashes,rulesHash:recorded.rulesHash,content,runner,analysis,toolchainId:setup.toolchainId});
    parentPort!.postMessage({matchId:task.matchId,ok:true,manifestHash:fileHash(await safeRead(task.directory,'manifest.json')),score:analysis.score,inputHash:hashCanonical(recorded.replay.inputs),finalWorldHash:recorded.replay.finalWorldHash});
  }catch(error){parentPort!.postMessage({matchId:task.matchId,ok:false,error:error instanceof Error?error.message:String(error),directory:resolve(task.directory)});}
});
