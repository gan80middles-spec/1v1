import { utilityVersion } from '../contracts/ai-version.js';
import { ContentSourceSchema } from '../contracts/content-schema.js';
import { ProductionFileSchemas, ReplayManifestSchema, HashCheckpointSchema, MatchAnalysisSchema, type ReplayManifest, type ReplayPackage } from '../contracts/production.js';
import type { InputReplay } from '../contracts/fighter.js';
import { hashCanonical } from '../math/hash.js';
import { canonicalSerialize } from '../math/canonical.js';
import { validatePresentation, embeddedContentHash } from './presentation.js';
export function decodeProductionFiles(manifestInput:unknown,roleTexts:ReadonlyMap<ReplayManifest['files'][number]['role'],string>):ReplayPackage {
  const manifest=ReplayManifestSchema.parse(manifestInput),rows=new Map<ReplayManifest['files'][number]['role'],unknown>();
  for(const file of manifest.files){const text=roleTexts.get(file.role);if(text===undefined)throw new Error('MISSING_FILE '+file.path);
    if(file.path.endsWith('.ndjson.gz'))rows.set(file.role,text.trim()?text.trim().split('\n').map(line=>ProductionFileSchemas[file.role].parse(JSON.parse(line))):[]);
    else rows.set(file.role,JSON.parse(text));}
  const content=ContentSourceSchema.parse(rows.get('content'));if(embeddedContentHash(content,manifest.pluginVersions)!==manifest.contentHash)throw new Error('CONTENT_HASH_MISMATCH');
  const inputs=(rows.get('inputs') as unknown[]).map(v=>ProductionFileSchemas.inputs.parse(v)),events=(rows.get('events') as unknown[]).map(v=>ProductionFileSchemas.events.parse(v)),director=(rows.get('director') as unknown[]).map(v=>ProductionFileSchemas.director.parse(v)),hashes=(rows.get('hashes') as unknown[]).map(v=>HashCheckpointSchema.parse(v)),analysis=MatchAnalysisSchema.parse(rows.get('analysis'));
  if(inputs.length!==manifest.durationTicks||inputs.some((v,i)=>v.tick!==i)||events.some((v,i)=>v.tick>=manifest.durationTicks||i>0&&(v.seq<=events[i-1]!.seq||v.tick<events[i-1]!.tick))||analysis.matchId!==manifest.replayId||analysis.durationTicks!==manifest.durationTicks)throw new Error('REPLAY_SEQUENCE_IDENTITY_MISMATCH');
  const eventIds=new Set(events.map(e=>e.seq));for(const e of events){if(e.sourceId!==null&&e.sourceId!==1&&e.sourceId!==2||e.targetId!==null&&e.targetId!==1&&e.targetId!==2||!eventIds.has(e.rootEventId)||e.rootEventId>e.seq||e.parentEventId!==null&&(!eventIds.has(e.parentEventId)||e.parentEventId>=e.seq)||e.type==='CastAccepted'&&!content.abilities.some(a=>a.id===e.payload.abilityId))throw new Error('EVENT_REFERENCE_MISMATCH');}
  if(hashCanonical(analysis.result)!==hashCanonical(manifest.result))throw new Error('ANALYSIS_RESULT_MISMATCH');
  const expected=[0,...Array.from({length:Math.floor(manifest.durationTicks/60)},(_,i)=>(i+1)*60)];if(manifest.durationTicks%60)expected.push(manifest.durationTicks);
  if(canonicalSerialize(hashes.map(h=>h.tick))!==canonicalSerialize(expected)||hashes.at(-1)!.worldHash!==manifest.finalWorldHash||hashes.at(-1)!.runnerHash!==manifest.finalRunnerHash)throw new Error('HASH_CHECKPOINT_SEQUENCE_MISMATCH');
  const profile=content.pacingProfiles.find(p=>p.id===manifest.config.pacing.profileId);
  if(manifest.config.pacing.mode==='off'&&director.length||manifest.config.pacing.mode!=='off'&&(!profile||hashCanonical(profile)!==manifest.pacingProfileHash||profile.version!==manifest.pacingProfileVersion)||director.length>18||director.some((v,i)=>v.tick>manifest.durationTicks||i>0&&v.tick<director[i-1]!.tick||v.cue.profileId!==profile?.id||v.cue.profileVersion!==profile?.version||v.cue.applyTick!==v.cue.issuedTick+1))throw new Error('DIRECTOR_RECORD_IDENTITY_MISMATCH');
  if(hashCanonical(manifest.config.participants.map(p=>content.profiles.find(profile=>profile.id===p.profileId)))!==manifest.aiProfileHash)throw new Error('AI_PROFILE_HASH_MISMATCH');
  if(['utility-v1','utility-v2','utility-v3','utility-v4','utility-v5'].includes(manifest.aiVersion)&&manifest.aiVersion!==utilityVersion({source:content,pluginVersions:manifest.pluginVersions},manifest.config.participants.map(p=>content.profiles.find(profile=>profile.id===p.profileId)!)))throw new Error('AI_VERSION_MISMATCH');
  const replay:InputReplay={replaySchemaVersion:2,engineBuild:manifest.engineBuild as InputReplay['engineBuild'],config:manifest.config,content,pluginVersions:manifest.pluginVersions,inputs,events,checkpoints:hashes.map(h=>({tick:h.tick,worldHash:h.worldHash})),finalWorldHash:manifest.finalWorldHash,result:manifest.result,directorRecords:director};
  const frames=rows.has('track')?validatePresentation(manifest,content,rows.get('track') as unknown[],events):[],checkpoints=(rows.get('checkpoints') as unknown[]|undefined??[]).map(cp=>ProductionFileSchemas.checkpoints.parse(cp));
  if(rows.has('checkpoints')){const expectedCP=[0,...Array.from({length:Math.floor(manifest.durationTicks/120)},(_,i)=>(i+1)*120)];if(manifest.durationTicks%120)expectedCP.push(manifest.durationTicks);if(canonicalSerialize(checkpoints.map(c=>c.nextTick))!==canonicalSerialize(expectedCP))throw new Error('FULL_CHECKPOINT_SEQUENCE_MISMATCH');}
  for(const [i,cp]of checkpoints.entries()){const {runnerHash,recording,...future}=cp;if(hashCanonical(future)!==runnerHash||cp.aiVersion!==manifest.aiVersion||cp.contentHash!==manifest.contentHash||cp.world.rulesHash!==manifest.rulesHash||canonicalSerialize(cp.config)!==canonicalSerialize(manifest.config)||i>0&&cp.nextTick<=checkpoints[i-1]!.nextTick||cp.nextTick!==cp.world.tick||hashes.find(h=>h.tick===cp.nextTick)?.runnerHash!==runnerHash||hashes.find(h=>h.tick===cp.nextTick)?.worldHash!==hashCanonical(cp.world))throw new Error('FULL_CHECKPOINT_HASH_IDENTITY_MISMATCH');}
  return {manifest,content,replay,hashes,frames,checkpoints,analysis};
}
