import type { ContentBundle } from '../contracts/content.js';
import type { Observation } from '../contracts/fighter.js';
import type { Slot } from '../contracts/versions.js';
import { abilityFor } from './abilities.js';
import { sweepCircles } from '../math/geometry.js';
import { statusGeometry } from '../math/ability-effects.js';
export const BASELINE_VERSION='public-rules-v2';
/** Fixed simple public rules; all four slots participate, without Utility scoring. */
export function baselineSlots(o:Observation,content:ContentBundle,aimX:-1|1,moveX:-1|0|1):Slot[]{
  if(!o.opponent)return [];
  const self=o.self.entity,enemy=o.opponent,age=Math.min(18,o.nowTick-(o.sensedTick??o.nowTick)),ex=enemy.position.x+enemy.velocity.x*age/60,ey=enemy.position.y+enemy.velocity.y*age/60;
  return o.self.legalSlots.filter(slot=>{
    const a=abilityFor(content,self.characterId,slot),activation=a.startupTicks;
    const status=a.timeline.flatMap(e=>e.effects).find(f=>f.kind==='status'),def=status?.kind==='status'?content.source.statuses.find(s=>s.id===status.statusId)!:null;
    if(a.ai.predictorId==='reflect'||a.ai.predictorId==='guard'){
      const projectile=o.projectiles.some(p=>{
        if(p.ownerId===self.id||a.ai.predictorId==='reflect'&&!p.reflectable)return false;
        const from={x:p.position.x+p.velocity.x*(age+activation)/60,y:p.position.y+p.velocity.y*(age+activation)/60},endTick=activation+(def?.durationTicks??1),to={x:p.position.x+p.velocity.x*(age+endTick)/60,y:p.position.y+p.velocity.y*(age+endTick)/60};
        const radius=self.body.radius+(def?.reflect?.extraRadius??0);
        // A projectile reaching the body before startup is not a usable defense opportunity.
        const early=sweepCircles({x:p.position.x+p.velocity.x*age/60,y:p.position.y+p.velocity.y*age/60},from,p.radius,self.body.position,self.body.position,self.body.radius);
        return early===null&&sweepCircles(from,to,p.radius,self.body.position,self.body.position,radius)!==null;
      });
      if(a.ai.predictorId==='reflect')return projectile;
      const tell=enemy.tell,enemyAbility=tell?content.source.abilities.find(x=>x.id===tell.abilityId):null;
      const committed=enemyAbility?.timeline.some(t=>t.effects.some(f=>f.kind==='hitbox'&&tell!.visibleSinceTick+t.offsetTick>=o.nowTick+activation&&Math.hypot(ex-self.body.position.x,ey-self.body.position.y)<Math.abs(f.offset.x)+f.radius+self.body.radius));
      return projectile||Boolean(committed);
    }
    if(a.ai.predictorId==='self-buff'){
      if(!def)return false;
      if(def.modifiers.bodyScale>1){const d=Math.hypot(ex-self.body.position.x,ey-self.body.position.y);return d<260&&Math.abs(ey-self.body.position.y)<100&&!self.statuses.some(s=>s.definitionId===def.id&&s.expiresTick>o.nowTick);}
      const vx=self.body.velocity.x,gap=vx>0?o.arena.width-self.body.radius-self.body.position.x:self.body.position.x-self.body.radius,wallTicks=Math.abs(vx)>250?gap/Math.abs(vx)*60:Infinity;
      return wallTicks>=activation&&wallTicks<90&&Math.abs(ey-self.body.position.y)<140&&Math.abs(ex-self.body.position.x)<450;
    }
    const ownGeometry=statusGeometry(content,self.characterId,self.statuses,o.nowTick);
    return a.timeline.some(t=>t.effects.some(f=>{
      const dt=t.offsetTick/60,ownX=self.body.position.x+(a.ai.predictorId==='dash-hit'?0:moveX*content.source.characters.find(c=>c.id===self.characterId)!.body.moveSpeed*a.movementScale*dt),target={x:ex+enemy.velocity.x*dt,y:ey+enemy.velocity.y*dt};
      if(f.kind==='projectile'){const dx=target.x-(ownX+48*aimX);return dx*aimX>=0&&Math.abs(target.y-(self.body.position.y+8))<=f.radius+enemy.radius&&Math.abs(dx)/f.speed*60<f.lifetimeTicks;}
      if(f.kind==='hitbox'){
        const from={x:ownX+f.offset.x*aimX,y:self.body.position.y+f.offset.y},impulse=a.timeline.flatMap(e=>e.effects).find(e=>e.kind==='impulse'),speed=a.ai.predictorId==='dash-hit'&&impulse?.kind==='impulse'?impulse.deltaV.x*aimX:0;
        return sweepCircles(from,{x:from.x+speed*f.durationTicks/60,y:from.y},f.radius*ownGeometry.meleeScale,target,{x:target.x+enemy.velocity.x*f.durationTicks/60,y:target.y+enemy.velocity.y*f.durationTicks/60},enemy.radius)!==null;
      }
      return false;
    }));
  });
}
