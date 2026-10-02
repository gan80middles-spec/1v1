import { utilityVersion } from '../contracts/ai-version.js';
import { gzipSync, gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { ReplayManifestSchema, type ReplayManifest, type ReplayPackage, type PresentationFrame, type MatchAnalysis } from '../contracts/production.js';
import type { ContentBundle } from '../contracts/content.js';
import type { InputReplay } from '../contracts/fighter.js';
import type { FullCheckpoint } from '../contracts/ai.js';
import { hashCanonical } from '../math/hash.js';
import { canonicalSerialize } from '../math/canonical.js';
import { decodeProductionFiles } from '../replay/package.js';
import { atomicWrite, atomicJSON, readJSON, safeRead, fileHash } from './files.js';

export async function saveReplayPackage(directory:string,data:{replay:InputReplay;content:ContentBundle;runner:ReplayManifest['runner'];hashes:{tick:number;worldHash:string;runnerHash:string}[];analysis:MatchAnalysis;toolchainId:string;rulesHash:string;frames?:PresentationFrame[];checkpoints?:FullCheckpoint[];beforeManifest?:(hash:string)=>Promise<void>}):Promise<ReplayManifest> {
  await mkdir(directory,{recursive:true});const files:ReplayManifest['files']=[];
  const write=async(role:ReplayManifest['files'][number]['role'],path:string,value:unknown,lines=false)=>{const raw=lines?(value as readonly unknown[]).map(v=>canonicalSerialize(v)).join('\n')+'\n':canonicalSerialize(value)+'\n',bytes=path.endsWith('.gz')?gzipSync(Buffer.from(raw,'utf8')):Buffer.from(raw,'utf8');await atomicWrite(resolve(directory,path),bytes);files.push({role,path,sha256:fileHash(bytes),bytes:bytes.length});};
  await write('content','content.json',data.replay.content);
  await write('inputs','inputs.ndjson.gz',data.replay.inputs,true);await write('events','events.ndjson.gz',data.replay.events,true);
  await write('director','director.ndjson.gz',data.replay.directorRecords??[],true);
  await write('hashes','hashes.json',data.hashes);await write('analysis','analysis.json',data.analysis);
  if(data.frames)await write('track','track.ndjson.gz',data.frames,true);
  if(data.checkpoints)await write('checkpoints','checkpoints.ndjson.gz',data.checkpoints,true);
  const profile=data.content.source.pacingProfiles.find(p=>p.id===data.replay.config.pacing.profileId),manifest=ReplayManifestSchema.parse({replaySchemaVersion:3,presentationVersion:1,replayId:data.replay.config.matchId,engineBuild:data.replay.engineBuild,aiVersion:utilityVersion(data.content, data.replay.config.participants.map(p=>data.content.source.profiles.find(profile=>profile.id===p.profileId)!)),rulesHash:data.rulesHash,pluginVersions:data.replay.pluginVersions,contentHash:data.content.bundleHash,aiProfileHash:hashCanonical(data.replay.config.participants.map(p=>data.content.source.profiles.find(profile=>profile.id===p.profileId))),toolchainId:data.toolchainId,seed:data.replay.config.seed,tickRate:60,durationTicks:data.replay.inputs.length,config:data.replay.config,result:data.replay.result,runner:data.runner,pacingProfileVersion:profile?.version??null,pacingProfileHash:profile?hashCanonical(profile):null,finalWorldHash:data.replay.finalWorldHash,finalRunnerHash:data.hashes.at(-1)!.runnerHash,files});
  // The manifest is the commit record: unreferenced interrupted files are never adopted.
  await data.beforeManifest?.(fileHash(Buffer.from(canonicalSerialize(manifest)+'\n')));await atomicJSON(resolve(directory,'manifest.json'),manifest);return manifest;
}
export async function loadReplayPackage(directory:string):Promise<ReplayPackage> {
  const manifest=ReplayManifestSchema.parse(await readJSON(resolve(directory,'manifest.json'))),texts=new Map<ReplayManifest['files'][number]['role'],string>();
  for(const file of manifest.files){const bytes=await safeRead(directory,file.path);if(bytes.length!==file.bytes||fileHash(bytes)!==file.sha256)throw new Error('FILE_HASH_MISMATCH '+file.path);const raw=file.path.endsWith('.gz')?gunzipSync(bytes,{maxOutputLength:512*1024*1024}):bytes;texts.set(file.role,raw.toString('utf8'));}
  return decodeProductionFiles(manifest,texts);
}
