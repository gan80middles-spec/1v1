import type { WorldView } from '../contracts/fighter.js';
import type { ContentBundle } from '../contracts/content.js';
import type { PresentationFrame } from '../contracts/production.js';
import { renderFrame } from '../replay/frame.js';
export function presentationFrame(world:WorldView,content:ContentBundle):PresentationFrame {
  const base=renderFrame(world);
  return {...base,entities:base.entities.map(e=>({...e,position:{...e.position},velocity:{...e.velocity},visibleStatusIds:[...e.visibleStatusIds],cooldownReadyTick:{...e.cooldownReadyTick}})),
    result:world.result?{...world.result,remainingHp:[...world.result.remainingHp]}:null,
    projectiles:world.projectiles.map(p=>({id:p.id,ownerId:p.ownerId,sourceCastId:p.sourceCastId,abilityId:p.abilityId,position:{...p.position},velocity:{...p.velocity},radius:p.radius})),
    hitboxes:base.hitboxes.map(h=>{const actual=world.hitboxes.find(x=>x.id===h.id)!;return {...h,position:{...h.position},ownerId:actual.ownerId,castId:actual.castId};}),
    visualEffects:world.entities.flatMap(e=>e.statuses.filter(s=>s.expiresTick>world.tick).map(s=>{const definition=content.source.statuses.find(d=>d.id===s.definitionId)!;return {id:s.instanceId,ownerId:e.id,castId:s.sourceCastId,statusId:s.definitionId,kind:definition.reflect?'shield' as const:'buff' as const,position:{...e.body.position},radius:e.body.radius+(definition.reflect?.extraRadius??0),startedTick:s.appliedTick,endsTick:s.expiresTick};})),discontinuityEntityIds:[]};
}
