import { z } from 'zod';
import { ContentSourceSchema } from './content-schema.js';
import { ActionIntentSchema, FighterConfigSchema, FighterResultSchema } from './fighter-schema.js';
import { UtilitySettingsSchema, DirectorRecordSchema, FullCheckpointSchema } from './ai-schema.js';
import type { BattleEvent, InputReplay } from './fighter.js';

export const REPLAY_PACKAGE_VERSION = 3;
export const SCORE_VERSION = 'interesting-v1';
export const RENDERER_VERSION = 'canvas-video-v2';
const n = z.number().finite(), tick = n.int().min(0).max(1000000), id = tick.min(1);
const hash = z.string().regex(/^[0-9a-f]{64}$/), vec = z.strictObject({x:n,y:n});
const name = z.string().min(1).max(120), slug = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const safePath = z.string().min(1).max(250).refine(value => !value.startsWith('/') && !/[\\:]/.test(value) && value.split('/').every(part => part && part!=='.' && part!=='..'), 'Expected a safe relative file path');
const slot = z.enum(['basic','skill1','skill2','ultimate']);
const payloads = {
  MatchStarted:z.strictObject({matchId:name}),
  CastAccepted:z.strictObject({requestId:id,castId:id,abilityId:name,slot}),
  CastFinished:z.strictObject({castId:id}), CastInterrupted:z.strictObject({castId:id,reason:z.enum(['hitstun','dead'])}),
  ActionRejected:z.strictObject({requestId:id,reason:z.enum(['ok','busy','cooldown','resource','air-ground','conflict','duplicate','hitstun','dead','condition'])}),
  Jumped:z.strictObject({requestId:id}), ProjectileSpawned:z.strictObject({projectileId:id,castId:id}),
  ProjectileExpired:z.strictObject({projectileId:id,reason:z.enum(['wall','lifetime','hit'])}),
  HitResolved:z.strictObject({castId:id,hitGroup:name,projectileId:id.nullable()}),
  ProjectileReflected:z.strictObject({projectileId:id,castId:id,defenseCastId:id.nullable(),previousOwnerId:id,reflectionCount:tick.max(2),velocity:vec,preventedDamage:n.min(0)}),
  ProjectileDissipated:z.strictObject({projectileId:id,castId:id,defenseCastId:id.nullable(),reflectionCount:tick.max(3)}),
  DamageResolved:z.strictObject({castId:id,amount:n.min(0),hpBefore:n.min(0),hpAfter:n.min(0)}),
  DamagePrevented:z.strictObject({castId:id,preventedDamage:n.min(0)}),
  WallBounce:z.strictObject({wall:z.enum(['left','right','floor','ceiling']),incomingNormalSpeed:n.min(0),castId:id.nullable()}),
  StatusApplied:z.strictObject({statusId:name,expiresTick:tick,stacks:id.max(8),castId:id.nullable()}),
  StatusExpired:z.strictObject({statusId:name}), PassiveTriggered:z.strictObject({passiveId:name,stacks:tick.max(3),expiresTick:tick}),
  EntityDied:z.strictObject({lastDamageCastId:id.nullable()}), Diagnostic:z.strictObject({code:name,detail:z.string().max(10000)}),
  MatchEnded:z.strictObject({result:FighterResultSchema}),
} satisfies Record<BattleEvent['type'],z.ZodType>;
const eventEnvelope = z.strictObject({seq:id,tick,sourceId:id.nullable(),targetId:id.nullable(),position:vec.nullable(),rootEventId:id,parentEventId:id.nullable(),depth:tick.max(4),type:z.enum(Object.keys(payloads) as [BattleEvent['type'],...BattleEvent['type'][]]),payload:z.unknown()});
export const BattleEventSchema = z.custom<BattleEvent>(value => {try {const event=eventEnvelope.parse(value);payloads[event.type].parse(event.payload);return true;}catch{return false;}},'Invalid typed battle event');
export const InputEntrySchema = z.strictObject({tick,intents:z.tuple([ActionIntentSchema,ActionIntentSchema])});
export const HashCheckpointSchema = z.strictObject({tick,worldHash:hash,runnerHash:hash});
export const RunnerRecordingSchema = z.strictObject({kinds:z.tuple([z.enum(['utility','rush','ranged','idle']),z.enum(['utility','rush','ranged','idle'])]),settings:UtilitySettingsSchema});
const fighter = z.strictObject({id,characterId:name,position:vec,velocity:vec,radius:n.positive(),facing:z.union([z.literal(-1),z.literal(1)]),hp:n.min(0),maxHp:n.positive(),energy:n.min(0).max(100),grounded:z.boolean(),actionPhase:z.enum(['free','startup','active','recovery','hitstun','dead']),abilityId:name.nullable(),visibleStatusIds:z.array(name).max(64),cooldownReadyTick:z.strictObject({basic:tick,skill1:tick,skill2:tick,ultimate:tick}),wallStacks:tick.max(3)});
export const PresentationFrameSchema = z.strictObject({
  tick,entities:z.array(fighter).length(2),
  projectiles:z.array(z.strictObject({id,ownerId:id,sourceCastId:id,abilityId:name,position:vec,velocity:vec,radius:n.positive()})).max(32),
  hitboxes:z.array(z.strictObject({id,ownerId:id,castId:id,position:vec,radius:n.positive()})).max(64),
  visualEffects:z.array(z.strictObject({id,ownerId:id,castId:id.nullable(),statusId:name,kind:z.enum(['shield','buff']),position:vec,radius:n.positive(),startedTick:tick,endsTick:tick})).max(128),
  discontinuityEntityIds:z.array(id).max(2),result:FighterResultSchema.nullable(),
});
export type PresentationFrame = z.infer<typeof PresentationFrameSchema>;
export const ReplayManifestSchema = z.strictObject({
  replaySchemaVersion:z.literal(3),presentationVersion:z.literal(1),replayId:slug,
  engineBuild:name,aiVersion:name,rulesHash:hash,pluginVersions:z.record(name,id),contentHash:hash,aiProfileHash:hash,toolchainId:name,
  seed:n.int().min(0).max(0xffffffff),tickRate:z.literal(60),durationTicks:tick.max(3600),
  config:FighterConfigSchema,result:FighterResultSchema,runner:RunnerRecordingSchema,
  pacingProfileVersion:id.nullable(),pacingProfileHash:hash.nullable(),finalWorldHash:hash,finalRunnerHash:hash,
  files:z.array(z.strictObject({role:z.enum(['content','inputs','events','track','checkpoints','director','hashes','analysis']),path:safePath,sha256:hash,bytes:n.int().min(0).max(1000000000)})).min(6).max(8),
}).superRefine((m,ctx)=>{
  if(m.seed!==m.config.seed||m.replayId!==m.config.matchId||m.contentHash!==m.config.contentHash||m.durationTicks!==m.result.endedAfterTicks||m.result.matchId!==m.replayId)ctx.addIssue({code:'custom',message:'Replay identity/config mismatch'});
  if(new Set(m.files.map(f=>f.role)).size!==m.files.length||new Set(m.files.map(f=>f.path)).size!==m.files.length)ctx.addIssue({code:'custom',message:'Duplicate replay role/path'});
  for(const role of ['content','inputs','events','director','hashes','analysis'])if(!m.files.some(f=>f.role===role))ctx.addIssue({code:'custom',message:'Missing replay role '+role});
  if((m.config.pacing.mode==='off')!==(m.pacingProfileVersion===null&&m.pacingProfileHash===null))ctx.addIssue({code:'custom',message:'Pacing profile identity mismatch'});
});
export type ReplayManifest = z.infer<typeof ReplayManifestSchema>;
export interface ReplayPackage {
  manifest:ReplayManifest; content:z.infer<typeof ContentSourceSchema>;
  replay:InputReplay; hashes:z.infer<typeof HashCheckpointSchema>[];
  frames:PresentationFrame[]; checkpoints:z.infer<typeof FullCheckpointSchema>[]; analysis:MatchAnalysis;
}
export interface DefenseEvidence {eventSeq:number;tick:number;defenderId:number;castId:number|null;effective:boolean;method:'actual-prevention'|'linear-30-tick'|'missing-pre-contact-state';horizonTicks:30;projectilePosition:{x:number;y:number}|null;projectileVelocity:{x:number;y:number}|null;targetPosition:{x:number;y:number}|null;targetVelocity:{x:number;y:number}|null;predictedContactTick:number|null;}
export interface ExchangeSummary {id:number;startTick:number;endTick:number;damageByParticipant:[number,number];effectiveCastIds:number[];effectiveAbilityIds:string[];wallChase:boolean;effectiveReflect:boolean;defenseCounter:boolean;airborneHit:boolean;effectiveUltimateCount:number;}
export interface MatchAnalysis {schemaVersion:1;scoreVersion:typeof SCORE_VERSION;matchId:string;durationTicks:number;exchanges:ExchangeSummary[];defenseEvidence:DefenseEvidence[];score:number;features:Record<string,number>;contributions:Record<string,number>;eligible:boolean;rejectionReasons:string[];signature:string[];matchup:string;winner:string|null;finishAbilityId:string;effectiveUltimateCastIds:number[];effectiveCastIds:number[];repeatedIneffectiveCasts:number;castCount:number;damage:[number,number];result:z.infer<typeof FighterResultSchema>;}
export const MatchAnalysisSchema:z.ZodType<MatchAnalysis> = z.strictObject({schemaVersion:z.literal(1),scoreVersion:z.literal(SCORE_VERSION),matchId:slug,durationTicks:tick,exchanges:z.array(z.strictObject({id,startTick:tick,endTick:tick,damageByParticipant:z.tuple([n.min(0),n.min(0)]),effectiveCastIds:z.array(id),effectiveAbilityIds:z.array(name),wallChase:z.boolean(),effectiveReflect:z.boolean(),defenseCounter:z.boolean(),airborneHit:z.boolean(),effectiveUltimateCount:tick})),defenseEvidence:z.array(z.strictObject({eventSeq:id,tick,defenderId:id,castId:id.nullable(),effective:z.boolean(),method:z.enum(['actual-prevention','linear-30-tick','missing-pre-contact-state']),horizonTicks:z.literal(30),projectilePosition:vec.nullable(),projectileVelocity:vec.nullable(),targetPosition:vec.nullable(),targetVelocity:vec.nullable(),predictedContactTick:n.nullable()})),score:n.min(0).max(100),features:z.record(z.string(),n),contributions:z.record(z.string(),n),eligible:z.boolean(),rejectionReasons:z.array(name),signature:z.array(z.string().min(1).max(1000)).max(13),matchup:name,winner:name.nullable(),finishAbilityId:name,effectiveUltimateCastIds:z.array(id),effectiveCastIds:z.array(id),repeatedIneffectiveCasts:tick,castCount:tick,damage:z.tuple([n.min(0),n.min(0)]),result:FighterResultSchema});

export const TimelineSegmentSchema = z.strictObject({startFrame:tick,endFrameExclusive:tick,sourceStartTick:tick,sourceEndTick:tick,kind:z.enum(['intro','battle','hold','outro'])});
export const RenderJobSchema = z.strictObject({schemaVersion:z.literal(1),id:slug,replayId:slug,replayManifestHash:hash,rendererVersion:z.enum(['canvas-video-v1','canvas-video-v2']),templateId:z.enum(['arena-dark','arena-light']),fps:z.literal(60),width:z.union([z.literal(1080),z.literal(720)]),height:z.union([z.literal(1920),z.literal(1280)]),timeline:z.array(TimelineSegmentSchema).min(3).max(5),totalFrames:tick.max(4000),toolchainId:name,visualSeed:n.int().min(0).max(0xffffffff),fontHash:hash,audioAssetsHash:hash,preset:z.enum(['vertical-1080','vertical-720']),keepFrames:z.boolean()}).superRefine((j,ctx)=>{
  let cursor=0;
  for(const s of j.timeline){if(s.startFrame!==cursor||s.endFrameExclusive<=s.startFrame||s.sourceEndTick<s.sourceStartTick||s.kind==='hold'&&s.sourceStartTick!==s.sourceEndTick)ctx.addIssue({code:'custom',message:'Invalid contiguous half-open timeline'});cursor=s.endFrameExclusive;}
  if(cursor!==j.totalFrames||j.width/ j.height!==9/16)ctx.addIssue({code:'custom',message:'Render dimensions/frame count mismatch'});
});
export type RenderJob = z.infer<typeof RenderJobSchema>;
export const FrameIndexSchema=z.strictObject({schemaVersion:z.literal(1),jobId:slug,frameCount:tick.max(4000),hashes:z.array(hash.nullable()).max(4000),cleaned:z.boolean()});
export type FrameIndex=z.infer<typeof FrameIndexSchema>;
export type TimelineSegment = z.infer<typeof TimelineSegmentSchema>;
export const ProductionConfigSchema = z.strictObject({schemaVersion:z.literal(1),id:slug,output:z.string().min(1),seed:n.int().min(0).max(0xffffffff),matchups:z.array(z.strictObject({a:z.enum(['standard','rubber','iron','mirror']),b:z.enum(['standard','rubber','iron','mirror'])})).min(1).max(10),countPerMatchup:id.max(1000),workers:id.max(32),top:id.max(100),pacing:z.enum(['off','observe','pace']),preset:z.enum(['vertical-1080','vertical-720']),templateId:z.enum(['arena-dark','arena-light']),keepFrames:z.boolean(),fullCheckpoints:z.boolean(),maxTicks:id.max(3600)});
export type ProductionConfig = z.infer<typeof ProductionConfigSchema>;
export const TaskStateSchema = z.enum(['pending','simulating','simulated','ranked','not-selected','selected','rebuilding-track','ready-to-render','rendering','encoding','verifying','complete','failed']);
export type TaskState = z.infer<typeof TaskStateSchema>;
const failure = z.strictObject({stage:name,errorCode:name,message:z.string().max(10000),diagnosticPath:name,seed:n.int().min(0).max(0xffffffff),attempt:tick.max(2)});
export const BatchTaskSchema = z.strictObject({matchId:slug,config:FighterConfigSchema,state:TaskStateSchema,attempts:tick.max(2),manifestHash:hash.nullable(),score:n.nullable(),selectionReason:z.string().nullable(),exportId:slug.nullable(),framesComplete:tick,totalFrames:tick,lastCompleteState:TaskStateSchema,failures:z.array(failure).max(30)});
export type BatchTask = z.infer<typeof BatchTaskSchema>;
export const BatchManifestSchema = z.strictObject({schemaVersion:z.literal(1),batchId:slug,createdAt:name,updatedAt:name,status:z.enum(['pending','running','cancelled','failed','complete','simulated','ranked']),config:ProductionConfigSchema,engineBuild:z.literal('phase3b-v1'),aiVersion:z.literal('utility-v3'),contentHash:hash,rulesHash:hash,scoreVersion:z.literal(SCORE_VERSION),toolchainId:name,workerCount:id.max(32),tasks:z.array(BatchTaskSchema).min(1).max(10000),selection:z.array(slug).max(100),rankingHash:hash.nullable(),failures:z.array(failure).max(10000)}).superRefine((b,ctx)=>{if(b.batchId!==b.config.id||new Set(b.tasks.map(t=>t.matchId)).size!==b.tasks.length||b.tasks.some(t=>t.config.matchId!==t.matchId||t.config.contentHash!==b.contentHash))ctx.addIssue({code:'custom',message:'Invalid frozen batch identities'});});
export type BatchManifest = z.infer<typeof BatchManifestSchema>;
export const ProductionFileSchemas = {content:ContentSourceSchema,inputs:InputEntrySchema,events:BattleEventSchema,director:DirectorRecordSchema,hashes:HashCheckpointSchema,track:PresentationFrameSchema,checkpoints:FullCheckpointSchema,analysis:MatchAnalysisSchema};
