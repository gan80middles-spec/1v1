import type { InputReplay, RenderFrame } from '../contracts/fighter.js';
import { wilson } from './ai-metrics.js';
export const METRICS_VERSION='behavior-v2';
export function evaluationMetrics(replay:InputReplay,frames:readonly RenderFrame[],entityId:number){
  if(frames.length!==replay.inputs.length+1||frames.some((f,i)=>f.tick!==i))throw new Error('Metrics require contiguous authoritative frames');
  const n=replay.inputs.length,events=replay.events,casts=events.filter(e=>e.type==='CastAccepted').filter(e=>e.sourceId===entityId),ownDamage=events.filter(e=>e.type==='DamageResolved').filter(e=>e.sourceId===entityId&&e.payload.amount>0),enemyDamage=events.filter(e=>e.type==='DamageResolved').filter(e=>e.targetId===entityId&&e.payload.amount>0),hitCasts=new Set(ownDamage.map(e=>e.payload.castId));
  const defenses=events.filter(e=>e.type==='DamagePrevented').filter(e=>e.sourceId===entityId&&e.payload.preventedDamage>0),reflections=events.filter(e=>e.type==='ProjectileReflected').filter(e=>e.sourceId===entityId);
  const effectiveCasts=new Set(hitCasts);for(const e of defenses)effectiveCasts.add(e.payload.castId);for(const e of reflections)if(e.payload.defenseCastId!==null)effectiveCasts.add(e.payload.defenseCastId);
  for(const cast of casts){
    const a=replay.content.abilities.find(a=>a.id===cast.payload.abilityId)!;
    if(a.ai.predictorId==='dash-hit'){
      const from=frames[cast.tick]!.entities[entityId-1]!,at=frames[Math.min(n,cast.tick+a.startupTicks+a.activeTicks)]!.entities[entityId-1]!,target=frames[cast.tick]!.entities.find(e=>e.id!==entityId)!;
      const before=Math.hypot(from.position.x-target.position.x,from.position.y-target.position.y),after=Math.hypot(at.position.x-target.position.x,at.position.y-target.position.y);
      if(before-after>=20)effectiveCasts.add(cast.payload.castId);
    }
    if(a.ai.predictorId==='self-buff')for(const fx of a.timeline.flatMap(t=>t.effects))if(fx.kind==='status'){
      const def=replay.content.statuses.find(s=>s.id===fx.statusId)!;
      const applied=events.filter(e=>e.type==='StatusApplied').find(e=>e.sourceId===entityId&&e.payload.castId===cast.payload.castId&&e.payload.statusId===def.id);
      if(!applied)continue;
      if(def.modifiers.wallGrowthCoefficientOverride!==null&&events.some(e=>e.type==='PassiveTriggered'&&e.sourceId===entityId&&e.tick>=applied.tick&&e.tick<applied.payload.expiresTick))effectiveCasts.add(cast.payload.castId);
      if(def.modifiers.meleeHitboxScale>1&&ownDamage.some(e=>e.tick>=applied.tick&&e.tick<applied.payload.expiresTick&&replay.content.abilities.find(a=>a.id===casts.find(c=>c.payload.castId===e.payload.castId)?.payload.abilityId)?.tags.includes('melee')))effectiveCasts.add(cast.payload.castId);
    }
  }
  let flips=0,last=0,wallTicks=0,wallRun=0,maxWallRun=0,readyRun=0,maxReadyWait=0,approach=0,moving=0,distance=0;
  const readyEpisodes:{ticks:number;censored:boolean}[]=[];
  for(let t=0;t<n;t++){
    const input=replay.inputs[t]!.intents[entityId-1]!,frame=frames[t]!,own=frame.entities[entityId-1]!,enemy=frame.entities.find(e=>e.id!==entityId)!;
    if(input.moveX){if(last&&last!==input.moveX)flips++;last=input.moveX;moving++;if(input.moveX*(enemy.position.x-own.position.x)>0)approach++;}
    distance+=Math.hypot(own.position.x-enemy.position.x,own.position.y-enemy.position.y);
    const width=replay.content.arenas.find(a=>a.id===replay.config.arenaId)!.width,pushing=input.moveX===-1&&own.position.x-own.radius<=8||input.moveX===1&&width-own.radius-own.position.x<=8,past=frames[Math.max(0,t-30)]!.entities[entityId-1]!;
    const enemyAbility=enemy.abilityId?replay.content.abilities.find(a=>a.id===enemy.abilityId):null,threat=(['startup','active'].includes(enemy.actionPhase)&&enemyAbility?.tags.some(t=>t==='melee'||t==='projectile')&&Math.hypot(own.position.x-enemy.position.x,own.position.y-enemy.position.y)<180)||frame.projectiles.some(p=>p.ownerId!==entityId&&Math.hypot(p.position.x-own.position.x,p.position.y-own.position.y)<210);
    if(pushing&&Math.abs(own.position.x-past.position.x)<8&&!threat&&!['hitstun','dead'].includes(own.actionPhase)){wallTicks++;wallRun++;maxWallRun=Math.max(maxWallRun,wallRun);}else wallRun=0;
    if(own.energy>=100){readyRun++;maxReadyWait=Math.max(maxReadyWait,readyRun);}else if(readyRun){readyEpisodes.push({ticks:readyRun,censored:false});readyRun=0;}
  }
  if(readyRun)readyEpisodes.push({ticks:readyRun,censored:true});
  const basics=casts.filter(c=>c.payload.slot==='basic'),skills=casts.filter(c=>c.payload.slot!=='basic'),ultimates=casts.filter(c=>c.payload.slot==='ultimate');
  const interactions=events.filter(e=>e.type==='DamageResolved'&&e.payload.amount>0||e.type==='DamagePrevented'&&e.payload.preventedDamage>0||e.type==='ProjectileReflected'),active=new Set<number>();
  for(const e of interactions)for(let t=e.tick;t<Math.min(n,e.tick+60);t++)active.add(t);
  const requests=replay.inputs.filter(e=>e.intents[entityId-1]!.requestId!==null).length,rejectedRequests=new Set(events.filter(e=>e.type==='ActionRejected'&&e.sourceId===entityId).map(e=>`${e.tick}:${e.type==='ActionRejected'?e.payload.requestId:0}`)).size;
  const basicMisses=basics.filter(c=>!hitCasts.has(c.payload.castId)).length,effectiveSkills=skills.filter(c=>effectiveCasts.has(c.payload.castId)).length;
  const byAbility=Object.fromEntries(replay.content.characters.find(c=>c.id===replay.config.participants[entityId-1]!.characterId) ? Object.values(replay.content.characters.find(c=>c.id===replay.config.participants[entityId-1]!.characterId)!.slots).map(id=>{const rows=casts.filter(c=>c.payload.abilityId===id);return [id,{casts:rows.length,effective:rows.filter(c=>effectiveCasts.has(c.payload.castId)).length}];}):[]);
  return {ticks:n,basicCasts:basics.length,basicMisses,basicMissRate:basics.length?basicMisses/basics.length:null,skillCasts:skills.length,effectiveSkills,skillEffectiveRate:skills.length?effectiveSkills/skills.length:null,ultimateCasts:ultimates.length,effectiveUltimates:ultimates.filter(c=>effectiveCasts.has(c.payload.castId)).length,requests,rejectedRequests,invalidRequestRate:requests?rejectedRequests/requests:null,directionFlips:flips,directionFlipsPerSecond:n?flips/(n/60):null,wallStallTicks:wallTicks,wallStallFraction:n?wallTicks/n:null,maxQuietWallRunTicks:maxWallRun,longWallStall:maxWallRun>120,firstInteractionSeconds:interactions.length?interactions[0]!.tick/60:null,effectiveInteractionTicks:active.size,effectiveInteractionFraction:n?active.size/n:null,maxFullEnergyWaitSeconds:maxReadyWait/60,fullEnergyEpisodes:readyEpisodes,meanCenterDistance:n?distance/n:null,movingTicks:moving,approachTicks:approach,activeApproachFraction:moving?approach/moving:null,damageDealt:ownDamage.reduce((s,e)=>s+e.payload.amount,0),damageTaken:enemyDamage.reduce((s,e)=>s+e.payload.amount,0),reflections:reflections.length,byAbility};
}
export type EvaluationMetrics=ReturnType<typeof evaluationMetrics>;
export interface EvaluationRow {a:string;baseline:string;split:string;winner:string|null;reason:string;metrics:EvaluationMetrics}
export function aggregateEvaluation(rows:readonly EvaluationRow[]){
  const valid=rows.filter(r=>r.reason!=='invalid'),sum=(key:'basicCasts'|'basicMisses'|'skillCasts'|'effectiveSkills'|'requests'|'rejectedRequests'|'ticks'|'effectiveInteractionTicks'|'movingTicks'|'approachTicks')=>valid.reduce((s,r)=>s+r.metrics[key],0),quantile=(values:number[],q:number)=>{values.sort((a,b)=>a-b);return values.length?values[Math.ceil(values.length*q)-1]!:null;};
  const wins=valid.filter(r=>r.winner==='utility').length,losses=valid.filter(r=>r.winner==='baseline').length,basicCasts=sum('basicCasts'),basicMisses=sum('basicMisses'),requests=sum('requests'),rejectedRequests=sum('rejectedRequests'),skillCasts=sum('skillCasts'),effectiveSkills=sum('effectiveSkills');
  const first=valid.map(r=>r.metrics.firstInteractionSeconds).filter((v):v is number=>v!==null);
  return {n:rows.length,valid:valid.length,invalid:rows.length-valid.length,wins,losses,draws:valid.length-wins-losses,winRate:valid.length?wins/valid.length:null,wilson95:wilson(wins,valid.length),basicCasts,basicMisses,basicMissRate:basicCasts?basicMisses/basicCasts:null,skillCasts,effectiveSkills,skillEffectiveRate:skillCasts?effectiveSkills/skillCasts:null,requests,rejectedRequests,invalidRequestRate:requests?rejectedRequests/requests:null,firstInteractionSamples:first.length,noInteractionMatches:valid.length-first.length,firstInteractionP90Seconds:quantile(first,.9),longWallStallMatches:valid.filter(r=>r.metrics.longWallStall).length,longWallStallMatchFraction:valid.length?valid.filter(r=>r.metrics.longWallStall).length/valid.length:null,effectiveInteractionFraction:sum('ticks')?sum('effectiveInteractionTicks')/sum('ticks'):null,directionFlipsPerSecond:sum('ticks')?valid.reduce((s,r)=>s+r.metrics.directionFlips,0)/(sum('ticks')/60):null,activeApproachFraction:sum('movingTicks')?sum('approachTicks')/sum('movingTicks'):null,meanCenterDistance:valid.length?valid.reduce((s,r)=>s+(r.metrics.meanCenterDistance??0),0)/valid.length:null,maxFullEnergyWaitSeconds:valid.length?Math.max(...valid.map(r=>r.metrics.maxFullEnergyWaitSeconds)):null};
}
