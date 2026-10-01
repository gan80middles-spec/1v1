import type { MotionState } from '../contracts/ai.js';
import type { Vec2 } from '../contracts/state.js';
import { sweepCircles, lerpPosition } from '../math/geometry.js';
import { reflectVelocity } from '../math/ability-effects.js';
export interface PredictionPoint {tick:number;body:MotionState}
export interface ProjectilePathInput {position:Vec2;velocity:Vec2;radius:number;birth:number;expires:number;ownerId:number;reflectionCount:number;reflectable:boolean}
export function pathPosition(points:readonly PredictionPoint[],tick:number):Vec2 {
  const a=points.findLast(p=>p.tick<=tick)??points[0]!,b=points.find(p=>p.tick>=tick)??points.at(-1)!;
  return a.tick===b.tick?{...a.body.position}:lerpPosition(a.body.position,b.body.position,(tick-a.tick)/(b.tick-a.tick));
}
/** Bounded geometric approximation, using only mature public evidence and own proposed action. */
export function predictProjectile(input:ProjectilePathInput,bodies:readonly {id:number;points:readonly PredictionPoint[];shield:(tick:number)=>number|null}[],arena:{width:number;height:number}) {
  let position={...input.position},velocity={...input.velocity},ownerId=input.ownerId,count=input.reflectionCount,ignoreOwner=true;
  const reflections:{tick:number;ownerId:number;count:number}[]=[];
  const grid=bodies[0]!.points.map(p=>p.tick),last=Math.min(30,input.expires);
  for(let i=1;i<grid.length;i++){
    let start=Math.max(grid[i-1]!,input.birth,0);const end=Math.min(grid[i]!,last);
    if(end<=start)continue;
    for(let attempts=0;attempts<4&&start<end;attempts++){
      const dt=(end-start)/60,to={x:position.x+velocity.x*dt,y:position.y+velocity.y*dt};
      let wall=1;
      for(const [key,size]of [['x',arena.width],['y',arena.height]]as const){if(position[key]<input.radius||position[key]>size-input.radius)wall=0;else if(to[key]<input.radius)wall=Math.min(wall,(input.radius-position[key])/(to[key]-position[key]));else if(to[key]>size-input.radius)wall=Math.min(wall,(size-input.radius-position[key])/(to[key]-position[key]));}
      let hit:{fraction:number;id:number;center:Vec2;shield:boolean}|null=null;
      for(const body of bodies){
        const fromBody=pathPosition(body.points,start),toBody=pathPosition(body.points,end),r=body.points.findLast(p=>p.tick<=start)!.body.radius,extra=body.shield(start);
        if(body.id===ownerId){if(count===0)continue;if(ignoreOwner&&Math.hypot(position.x-fromBody.x,position.y-fromBody.y)<=r+(extra??0)+input.radius+1)continue;ignoreOwner=false;}
        const check=(radius:number,shield:boolean)=>{const f=sweepCircles(position,to,input.radius,fromBody,toBody,radius);if(f===null)return;const when=start+(end-start)*f;if(when>=end-1e-8&&end<last)return;if(!hit||f<hit.fraction-1e-9||Math.abs(f-hit.fraction)<1e-9&&shield&&!hit.shield)hit={fraction:f,id:body.id,center:lerpPosition(fromBody,toBody,f),shield};};
        check(r,false);if(input.reflectable&&extra!==null)check(r+extra,true);
      }
      // Assigned in the contact callback above.
      const contact=hit as {fraction:number;id:number;center:Vec2;shield:boolean}|null;
      if(contact&&contact.fraction<=wall){
        const tick=start+(end-start)*contact.fraction,at=lerpPosition(position,to,contact.fraction);
        if(!contact.shield)return {hit:{tick,targetId:contact.id,ownerId},reflections,dissipated:false};
        if(count>=2)return {hit:null,reflections,dissipated:true};
        velocity=reflectVelocity(velocity,{x:at.x-contact.center.x,y:at.y-contact.center.y});ownerId=contact.id;count++;ignoreOwner=true;reflections.push({tick,ownerId,count});
        start=tick+1e-5;position={x:at.x+velocity.x/60*1e-5,y:at.y+velocity.y/60*1e-5};
      }else {if(wall<1)return {hit:null,reflections,dissipated:false};position=to;start=end;}
    }
  }
  return {hit:null,reflections,dissipated:false};
}
