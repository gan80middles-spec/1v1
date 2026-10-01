import type { ContentBundle } from '../../contracts/content.js';
import type { FighterEntity, Projectile } from '../../contracts/fighter.js';
import type { Vec2 } from '../../contracts/state.js';
import { lerpPosition, sweepCircles } from '../../math/geometry.js';
import { reflectVelocity, statusGeometry } from '../../math/ability-effects.js';
import type { Segment } from '../physics/motion.js';
type Contact={time:number;entity:FighterEntity;center:Vec2;defenseCastId:number|null};
export type ProjectileContact={kind:'move'}|{kind:'wall'}|{kind:'hit';target:FighterEntity;position:Vec2}|{kind:'reflect'|'dissipate';target:FighterEntity;previousOwnerId:number;position:Vec2;defenseCastId:number|null};
export function projectileSubstep(p:Projectile,entities:readonly FighterEntity[],paths:readonly Segment[][],content:ContentBundle,tick:number,arena:{width:number;height:number}):ProjectileContact {
  const from={...p.position},to={x:from.x+p.velocity.x/240,y:from.y+p.velocity.y/240},owner=entities.find(e=>e.id===p.ownerId)!;
  if(p.ignoreOwnerUntilOutside && Math.hypot(from.x-paths[owner.id-1]![0]!.from.x,from.y-paths[owner.id-1]![0]!.from.y)>(p.ignoreRadius??owner.body.radius+p.radius+1)) {
    p.ignoreOwnerUntilOutside=false;delete p.ignoreRadius;
  }
  let wallTime=1;
  for(const [key,size] of [['x',arena.width],['y',arena.height]] as const){
    if(from[key]<p.radius||from[key]>size-p.radius)wallTime=0;
    else if(to[key]<p.radius)wallTime=Math.min(wallTime,(p.radius-from[key])/(to[key]-from[key]));
    else if(to[key]>size-p.radius)wallTime=Math.min(wallTime,(size-p.radius-from[key])/(to[key]-from[key]));
  }
  const ability=content.source.abilities.find(a=>a.id===p.abilityId)!,reflectable=ability.timeline.some(t=>t.effects.some(f=>f.kind==='projectile'&&f.reflectable));
  let hit:Contact|null=null,shield:Contact|null=null;
  for(let i=0;i<entities.length;i++){
    const e=entities[i]!;
    if(e.id===p.ownerId&&(p.reflectionCount===0||p.ignoreOwnerUntilOutside))continue;
    const geometry=statusGeometry(content,e.characterId,e.statuses,tick);
    const reflector=e.statuses.filter(s=>s.expiresTick>tick).find(s=>content.source.statuses.find(d=>d.id===s.definitionId)!.reflect?.extraRadius===geometry.reflectExtra);
    for(const s of paths[i]!){
      const find=(radius:number):Contact|null=>{const f=sweepCircles(lerpPosition(from,to,s.start),lerpPosition(from,to,s.end),p.radius,s.from,s.to,radius);if(f===null)return null;return {time:s.start+(s.end-s.start)*f,entity:e,center:lerpPosition(s.from,s.to,f),defenseCastId:reflector?.sourceCastId??null};};
      const body=find(e.body.radius);
      if(body&&(!hit||body.time<hit.time))hit=body;
      if(reflectable&&geometry.reflectExtra!==null){const c=find(e.body.radius+geometry.reflectExtra);if(c&&(!shield||c.time<shield.time))shield=c;}
    }
  }
  if(shield&&shield.time<=wallTime&&(!hit||shield.time<=hit.time+1e-9)){
    const position=lerpPosition(from,to,shield.time),previousOwnerId=p.ownerId;
    if(p.reflectionCount>=2)return {kind:'dissipate',target:shield.entity,previousOwnerId,position,defenseCastId:shield.defenseCastId};
    p.velocity=reflectVelocity(p.velocity,{x:position.x-shield.center.x,y:position.y-shield.center.y});
    p.ownerId=shield.entity.id;p.reflectionCount++;p.ignoreOwnerUntilOutside=true;
    p.ignoreRadius=shield.entity.body.radius+statusGeometry(content,shield.entity.characterId,shield.entity.statuses,tick).reflectExtra!+p.radius+1;
    p.position={x:position.x+p.velocity.x*(1-shield.time)/240,y:position.y+p.velocity.y*(1-shield.time)/240};
    return {kind:'reflect',target:shield.entity,previousOwnerId,position,defenseCastId:shield.defenseCastId};
  }
  if(hit&&hit.time<=wallTime)return {kind:'hit',target:hit.entity,position:lerpPosition(from,to,hit.time)};
  if(wallTime<1||to.x<=p.radius||to.x>=arena.width-p.radius||to.y<=p.radius||to.y>=arena.height-p.radius)return {kind:'wall'};
  p.position=to;return {kind:'move'};
}
