import type { InputReplay, BattleEvent } from '../contracts/fighter.js';
import { SCORE_VERSION, MatchAnalysisSchema, type MatchAnalysis, type PresentationFrame, type DefenseEvidence, type ExchangeSummary } from '../contracts/production.js';
import { sweepCircles } from '../math/geometry.js';
const clamp=(v:number)=>Math.max(0,Math.min(1,v));
type DamageEvent = Extract<BattleEvent,{type:'DamageResolved'}>;
interface Mark {start:number;end:number;castId:number|null;actorId:number;abilityId:string|null;defense:boolean;reflect:boolean;}

export function analyzeMatch(replay:InputReplay,frames:readonly PresentationFrame[],options:{replayVerified?:boolean;filesComplete?:boolean;allowDraw?:boolean}={}):MatchAnalysis {
  if(frames.length!==replay.inputs.length+1||frames.some((f,i)=>f.tick!==i))throw new Error('Analysis requires contiguous authoritative presentation frames');
  const events=replay.events,casts=events.filter(e=>e.type==='CastAccepted'),castById=new Map(casts.map(c=>[c.payload.castId,c])),duration=replay.inputs.length;
  const ability=(castId:number)=>replay.content.abilities.find(a=>a.id===castById.get(castId)?.payload.abilityId);
  const damageEvents=events.filter((e):e is DamageEvent=>e.type==='DamageResolved'&&e.payload.amount>0),groups=new Map<string,DamageEvent[]>();
  for(const event of damageEvents){const key=`${event.sourceId}:${event.payload.castId}:${event.targetId}`,group=groups.get(key)??[];group.push(event);groups.set(key,group);}
  const marks:Mark[]=[],effectiveOwn=new Set<string>(),effectiveIds=new Set<number>(),effectiveDamage:DamageEvent[]=[],defenseEvidence:DefenseEvidence[]=[],defenses:{tick:number;actorId:number;reflect:boolean;castId:number|null}[]=[];
  for(const group of groups.values())if(group.reduce((sum,e)=>sum+e.payload.amount,0)>=1){const first=group[0]!,last=group.at(-1)!;
    marks.push({start:first.tick,end:last.tick,castId:first.payload.castId,actorId:first.sourceId!,abilityId:ability(first.payload.castId)?.id??null,defense:false,reflect:false});effectiveOwn.add(`${first.sourceId}:${first.payload.castId}`);effectiveIds.add(first.payload.castId);effectiveDamage.push(...group);}
  for(const event of events){if(event.type!=='DamagePrevented'&&event.type!=='ProjectileReflected'&&event.type!=='ProjectileDissipated')continue;
    const defenderId=event.sourceId!,castId=event.type==='DamagePrevented'?event.payload.castId:event.payload.defenseCastId;
    let evidence:DefenseEvidence={eventSeq:event.seq,tick:event.tick,defenderId,castId,effective:false,method:'missing-pre-contact-state',horizonTicks:30,projectilePosition:null,projectileVelocity:null,targetPosition:null,targetVelocity:null,predictedContactTick:null};
    if(event.type==='DamagePrevented')evidence={...evidence,effective:event.payload.preventedDamage>0,method:'actual-prevention',predictedContactTick:event.tick};
    else {const frame=frames[event.tick]!,projectile=frame.projectiles.find(p=>p.id===event.payload.projectileId),target=frame.entities.find(e=>e.id===defenderId);
      if(projectile&&target){const seconds=.5,position=event.position??projectile.position,to=(p:{x:number;y:number},v:{x:number;y:number})=>({x:p.x+v.x*seconds,y:p.y+v.y*seconds});
        const hit=sweepCircles(position,to(position,projectile.velocity),projectile.radius,target.position,to(target.position,target.velocity),target.radius);
        evidence={...evidence,effective:hit!==null,method:'linear-30-tick',projectilePosition:{...position},projectileVelocity:{...projectile.velocity},targetPosition:{...target.position},targetVelocity:{...target.velocity},predictedContactTick:hit===null?null:event.tick+hit*30};}}
    defenseEvidence.push(evidence);if(!evidence.effective)continue;
    defenses.push({tick:event.tick,actorId:defenderId,reflect:event.type!=='DamagePrevented',castId});
    marks.push({start:event.tick,end:event.tick,castId,actorId:defenderId,abilityId:castId===null?null:ability(castId)?.id??null,defense:true,reflect:event.type!=='DamagePrevented'});
    if(castId!==null){effectiveOwn.add(`${defenderId}:${castId}`);effectiveIds.add(castId);}
  }
  const benefitTick=new Map<number,number>();
  for(const cast of casts){const a=ability(cast.payload.castId)!;
    if(effectiveOwn.has(`${cast.sourceId}:${cast.payload.castId}`))benefitTick.set(cast.payload.castId,marks.find(m=>m.castId===cast.payload.castId&&m.actorId===cast.sourceId)!.start);
    if(a.tags.includes('mobility')){const before=frames[cast.tick]!,after=frames[Math.min(duration,cast.tick+a.startupTicks+a.activeTicks)]!,own=before.entities.find(e=>e.id===cast.sourceId)!,end=after.entities.find(e=>e.id===cast.sourceId)!,enemy=before.entities.find(e=>e.id!==cast.sourceId)!,enemyEnd=after.entities.find(e=>e.id!==cast.sourceId)!,character=replay.content.characters.find(c=>c.id===own.characterId)!,band=replay.content.abilities.find(a=>a.id===character.slots.basic)!.ai.preferredCenterDistance;
      const gap=(d:number)=>Math.max(band[0]-d,0,d-band[1]);
      if(Math.hypot(own.position.x-end.position.x,own.position.y-end.position.y)>=40&&gap(Math.hypot(own.position.x-enemy.position.x,own.position.y-enemy.position.y))-gap(Math.hypot(end.position.x-enemyEnd.position.x,end.position.y-enemyEnd.position.y))>=40)benefitTick.set(cast.payload.castId,after.tick);}
    if(a.tags.includes('buff'))for(const status of events.filter(e=>e.type==='StatusApplied').filter(e=>e.payload.castId===cast.payload.castId)){
      const definition=replay.content.statuses.find(s=>s.id===status.payload.statusId)!;
      const next=events.find(e=>e.type==='StatusApplied'&&e.seq>status.seq&&e.sourceId===status.sourceId&&e.payload.statusId===status.payload.statusId&&definition.stacking!=='stack');
      const benefit=events.find(e=>e.sourceId===cast.sourceId&&e.seq>status.seq&&e.tick<status.payload.expiresTick&&(!next||e.seq<next.seq)&&
        (e.type==='PassiveTriggered'&&definition.modifiers.wallGrowthCoefficientOverride!==null||e.type==='DamageResolved'&&definition.modifiers.meleeHitboxScale>1&&effectiveOwn.has(`${e.sourceId}:${e.payload.castId}`)&&ability(e.payload.castId)?.tags.includes('melee')));
      if(benefit)benefitTick.set(cast.payload.castId,benefit.tick);
    }
    if(benefitTick.has(cast.payload.castId)){effectiveOwn.add(`${cast.sourceId}:${cast.payload.castId}`);effectiveIds.add(cast.payload.castId);}
  }
  const ultimateCasts=casts.filter(c=>c.payload.slot==='ultimate'&&benefitTick.has(c.payload.castId)),exchanges:ExchangeSummary[]=[];
  marks.sort((a,b)=>a.start-b.start||a.end-b.end||(a.castId??0)-(b.castId??0));
  for(const mark of marks){let segment=exchanges.at(-1);if(!segment||mark.start-segment.endTick>90){segment={id:exchanges.length+1,startTick:mark.start,endTick:mark.end,damageByParticipant:[0,0],effectiveCastIds:[],effectiveAbilityIds:[],wallChase:false,effectiveReflect:false,defenseCounter:false,airborneHit:false,effectiveUltimateCount:0};exchanges.push(segment);}segment.endTick=Math.max(segment.endTick,mark.end);if(mark.castId!==null&&!segment.effectiveCastIds.includes(mark.castId))segment.effectiveCastIds.push(mark.castId);if(mark.abilityId&&!segment.effectiveAbilityIds.includes(mark.abilityId))segment.effectiveAbilityIds.push(mark.abilityId);segment.effectiveReflect ||= mark.reflect;}
  const bounces=events.filter(e=>e.type==='WallBounce').filter(e=>e.payload.castId!==null&&e.payload.incomingNormalSpeed>=250&&e.payload.wall!=='floor');
  for(const segment of exchanges){const hits=damageEvents.filter(e=>e.tick>=segment.startTick&&e.tick<=segment.endTick),effectiveHits=effectiveDamage.filter(e=>e.tick>=segment.startTick&&e.tick<=segment.endTick);
    for(const hit of hits)if(hit.sourceId===1||hit.sourceId===2)segment.damageByParticipant[hit.sourceId-1]!+=hit.payload.amount;
    segment.airborneHit=effectiveHits.some(e=>frames[e.tick]!.entities.some(actor=>!actor.grounded));
    segment.defenseCounter=effectiveHits.some(hit=>defenses.some(d=>d.actorId===hit.sourceId&&hit.tick>d.tick&&hit.tick-d.tick<=60));
    segment.wallChase=effectiveHits.some(hit=>bounces.some(bounce=>{const launch=damageEvents.findLast(d=>d.seq<bounce.seq&&d.targetId===bounce.sourceId&&d.payload.castId===bounce.payload.castId),owner=launch?.sourceId??castById.get(bounce.payload.castId!)?.sourceId;return bounce.sourceId===hit.targetId&&hit.tick>bounce.tick&&hit.tick-bounce.tick<=60&&owner===hit.sourceId;}));
    const ultimates=ultimateCasts.filter(c=>benefitTick.get(c.payload.castId)!>=segment.startTick&&benefitTick.get(c.payload.castId)!<=segment.endTick);segment.effectiveUltimateCount=ultimates.length;
    for(const c of ultimates){if(!segment.effectiveCastIds.includes(c.payload.castId))segment.effectiveCastIds.push(c.payload.castId);if(!segment.effectiveAbilityIds.includes(c.payload.abilityId))segment.effectiveAbilityIds.push(c.payload.abilityId);}
    segment.effectiveCastIds.sort((a,b)=>a-b);segment.effectiveAbilityIds.sort();}
  const damage:[number,number]=[0,0];for(const hit of damageEvents)if(hit.sourceId===1||hit.sourceId===2)damage[hit.sourceId-1]!+=hit.payload.amount;
  let repeated=0;const recent=new Map<string,{tick:number;effective:boolean}[]>();
  for(const cast of casts){const a=ability(cast.payload.castId)!,deadline=cast.tick+Math.max(a.startupTicks+a.activeTicks+a.recoveryTicks,...a.timeline.flatMap(t=>t.effects.map(e=>t.offsetTick+(e.kind==='projectile'?e.lifetimeTicks:e.kind==='hitbox'?e.durationTicks:e.kind==='status'?replay.content.statuses.find(s=>s.id===e.statusId)!.durationTicks:0))));
    if(deadline>=duration)continue;const key=`${cast.sourceId}:${cast.payload.slot}`,uses=(recent.get(key)??[]).filter(u=>u.tick>=deadline-180),effective=effectiveOwn.has(`${cast.sourceId}:${cast.payload.castId}`);
    if(effective)uses.length=0;else if(uses.length>=2)repeated++;uses.push({tick:deadline,effective});recent.set(key,uses);}
  let longest=0,last=0,covered=0;for(const exchange of exchanges){longest=Math.max(longest,exchange.startTick-last);covered+=exchange.endTick-exchange.startTick+1;last=exchange.endTick;}longest=Math.max(longest,duration-last);
  const winnerIndex=replay.config.participants.findIndex(p=>p.participantId===replay.result.winnerParticipantId),winning=winnerIndex>=0?frames.at(-1)!.entities[winnerIndex]!:null;
  let deficit=0,deficitTick=0;if(winnerIndex>=0)for(const frame of frames){const own=frame.entities[winnerIndex]!,opponent=frame.entities[1-winnerIndex]!,d=opponent.hp/opponent.maxHp-own.hp/own.maxHp;if(d>deficit){deficit=d;deficitTick=frame.tick;}}
  const comeback=deficit>=.15&&effectiveDamage.some(e=>e.sourceId===winnerIndex+1&&e.tick>=deficitTick)?clamp(deficit/.35):0,seconds=duration/60,time=seconds>=20&&seconds<=45?1:seconds<20?clamp((seconds-8)/12):clamp((60-seconds)/15);
  const features={E:clamp(exchanges.length/10),C:clamp(exchanges.filter(e=>e.wallChase).length/3),I:clamp(exchanges.filter(e=>e.effectiveReflect||e.defenseCounter||e.airborneHit).length/4),U:clamp(ultimateCasts.length/2),V:clamp(new Set(casts.filter(c=>c.payload.slot!=='basic'&&effectiveOwn.has(`${c.sourceId}:${c.payload.castId}`)).map(c=>c.payload.abilityId)).size/5),B:Math.max(...damage)>0?Math.min(...damage)/Math.max(...damage):0,F:winning&&winning.hp/winning.maxHp<=.35?1-winning.hp/winning.maxHp/.35:0,R:comeback,T:time,N:clamp(((duration?1-covered/duration:1)-.25)/.5),Q:casts.length?repeated/casts.length:0,S:clamp((longest-180)/360)};
  const weights:Record<keyof typeof features,number>={E:16,C:10,I:12,U:12,V:8,B:8,F:8,R:8,T:18,N:-15,Q:-10,S:-15},contributions=Object.fromEntries(Object.entries(features).map(([key,value])=>[key,value*weights[key as keyof typeof features]])),score=Math.max(0,Math.min(100,Object.values(contributions).reduce((a,b)=>a+b,0)));
  const rejectionReasons:string[]=[];if(replay.result.reason==='invalid')rejectionReasons.push('invalid');if(options.replayVerified===false)rejectionReasons.push('replay-hash-drift');if(options.filesComplete===false)rejectionReasons.push('missing-files');if(replay.result.reason==='timeout')rejectionReasons.push('timeout');if(seconds<8)rejectionReasons.push('duration-under-8s');if(replay.result.reason!=='ko'&&!options.allowDraw)rejectionReasons.push('default-ko-only');
  const finishing=events.findLast(e=>e.type==='EntityDied'&&e.payload.lastDamageCastId!==null),finishAbilityId=finishing?.type==='EntityDied'?ability(finishing.payload.lastDamageCastId!)?.id??'unknown':'none';
  return MatchAnalysisSchema.parse({schemaVersion:1,scoreVersion:SCORE_VERSION,matchId:replay.config.matchId,durationTicks:duration,exchanges,defenseEvidence,score,features,contributions,eligible:rejectionReasons.length===0,rejectionReasons,signature:[...exchanges.slice(0,12).map(e=>[e.effectiveReflect?'reflect':'',e.wallChase?'chase':'',e.defenseCounter?'counter':'',e.airborneHit?'air':'',e.effectiveUltimateCount?'ultimate':'','exchange'].filter(Boolean).join('+')+':'+e.effectiveAbilityIds.join(',')),'finish:'+finishAbilityId],matchup:replay.config.participants.map(p=>p.characterId).sort().join('-vs-'),winner:winning?.characterId??null,finishAbilityId,effectiveUltimateCastIds:ultimateCasts.map(c=>c.payload.castId),effectiveCastIds:[...effectiveIds].sort((a,b)=>a-b),repeatedIneffectiveCasts:repeated,castCount:casts.length,damage,result:replay.result});
}

export function rankMatches(analyses:readonly MatchAnalysis[],top:number) {
  if(!Number.isInteger(top)||top<1)throw new Error('Top K must be a positive integer');
  const sorted=[...analyses].sort((a,b)=>b.score-a.score||a.matchId.localeCompare(b.matchId,'en')),selected:MatchAnalysis[]=[],counts=new Map<string,number>(),signatures=new Set<string>(),singleMatchup=new Set(sorted.filter(a=>a.eligible).map(a=>a.matchup)).size===1;
  const matchupLimit=singleMatchup?top:Math.max(1,Math.ceil(top/5)),winnerLimit=Math.max(1,Math.ceil(top*.6)),finishLimit=Math.max(1,Math.ceil(top*.5));
  const rows=sorted.map(analysis=>{let reason=analysis.eligible?'ranked':analysis.rejectionReasons.join(',');let accepted=false;
    const key=analysis.matchup+'|'+analysis.signature.join('|'),winner='winner:'+analysis.winner,finish='finish:'+analysis.finishAbilityId;
    if(analysis.eligible){if(signatures.has(key))reason='duplicate-signature';else if((counts.get(analysis.matchup)??0)>=matchupLimit)reason='matchup-diversity-limit';else if((counts.get(winner)??0)>=winnerLimit)reason='winner-diversity-limit';else if((counts.get(finish)??0)>=finishLimit)reason='finish-diversity-limit';else if(selected.length>=top)reason='outside-top-k';else{accepted=true;reason='selected';selected.push(analysis);signatures.add(key);for(const countKey of [analysis.matchup,winner,finish])counts.set(countKey,(counts.get(countKey)??0)+1);}}
    return {matchId:analysis.matchId,score:analysis.score,eligible:analysis.eligible,selected:accepted,reason,features:analysis.features,contributions:analysis.contributions,signature:analysis.signature,matchup:analysis.matchup,winner:analysis.winner,finishAbilityId:analysis.finishAbilityId};});
  return {schemaVersion:1,scoreVersion:SCORE_VERSION,requested:top,selected: selected.map(a=>a.matchId),actual:selected.length,shortfall:Math.max(0,top-selected.length),limits:{matchupLimit,winnerLimit,finishLimit,singleMatchupRelaxed:singleMatchup},rows};
}
