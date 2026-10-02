import {eligiblePool,choose} from '../dist/node/ai/selection.js';
export function counterfactualSelection(trace,profile){
 const candidates=structuredClone(trace.candidates);for(const c of candidates)if(c.score)c.score.Uraw=c.score.Ubase??c.score.Uraw;
 const current=candidates.find(c=>c.option.key===trace.continuationKey),held=current!==undefined&&trace.nowTick<trace.executionBefore.minimumHoldUntilTick;
 const pool=eligiblePool(candidates,current?.score?.Uraw??null,held,trace.emergency,profile.nearBestBand),selected=choose(pool,trace.choiceDraw,true,profile.nearBestBand);
 return {selectedKey:selected?.option.key??trace.continuationKey,pool:pool.map(c=>c.option.key)};
}
export function mechanismEvidence(runner,replay,kind){
 for(const entry of runner.traces){const t=entry.trace;if(t.directorCue?.kind!==kind)continue;const selected=t.candidates.find(c=>c.option.key===t.selectedKey),profile=runner.content.source.profiles.find(p=>p.id===t.profileId),cf=counterfactualSelection(t,profile);if(cf.selectedKey===t.selectedKey)continue;
  if(kind==='engage'&&!(selected?.score?.director?.applied>0&&selected.outcome?.bandProgressPx>0))continue;
  if(kind==='vary'&&!cf.selectedKey?.startsWith('cast:basic'))continue;
  if(kind==='showcase'&&t.input.cast?.slot!=='ultimate')continue;
  const accepted=replay.events.find(e=>e.type==='CastAccepted'&&e.tick===t.nowTick&&e.sourceId===entry.entityId&&e.payload.requestId===t.input.requestId),actualDamage=accepted?replay.events.filter(e=>e.type==='DamageResolved'&&e.sourceId===entry.entityId&&e.payload.castId===accepted.payload.castId).reduce((s,e)=>s+e.payload.amount,0):0;
  let buffEvidence=[];if(accepted){const statuses=replay.events.filter(e=>e.type==='StatusApplied'&&e.payload.castId===accepted.payload.castId);buffEvidence=statuses.flatMap(status=>replay.events.filter(e=>e.sourceId===entry.entityId&&e.tick>=status.tick&&e.tick<status.payload.expiresTick&&(e.type==='PassiveTriggered'||e.type==='DamagePrevented'&&e.payload.castId===accepted.payload.castId||e.type==='ProjectileReflected'&&e.payload.defenseCastId===accepted.payload.castId||e.type==='DamageResolved'&&replay.content.statuses.find(s=>s.id===status.payload.statusId).modifiers.meleeHitboxScale>1)));}
  if(kind==='showcase'&&actualDamage<1&&!buffEvidence.length)continue;
  const before=runner.frames[t.nowTick],after=runner.frames[Math.min(runner.frames.length-1,t.nowTick+120)],dist=f=>f?Math.hypot(f.entities[0].position.x-f.entities[1].position.x,f.entities[0].position.y-f.entities[1].position.y):null;
  return {entityId:entry.entityId,tick:t.nowTick,cue:t.directorCue,counterfactual:cf,selectedKey:t.selectedKey,selectedScore:selected?.score,accepted:accepted??null,actualDamage,buffEvidence,centerDistanceBefore:dist(before),centerDistanceAfter120Ticks:dist(after)};
 }
 return null;
}
