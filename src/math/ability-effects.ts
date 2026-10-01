import type { ContentBundle } from '../contracts/content.js';
import type { StatusInstance } from '../contracts/fighter.js';
import type { Vec2 } from '../contracts/state.js';

/** Geometry and speed damage use the same definitions in simulation and prediction. */
export function statusGeometry(content: ContentBundle, characterId: string, statuses: readonly Pick<StatusInstance,'definitionId'|'stacks'|'expiresTick'>[], tick: number) {
  const base = content.source.characters.find(c => c.id === characterId)!;
  let bodyScale=1, massScale=1, meleeScale=1, reflectExtra: number|null=null;
  for (const s of statuses.filter(s => s.expiresTick > tick)) {
    const d=content.source.statuses.find(d=>d.id===s.definitionId)!;
    bodyScale=Math.max(bodyScale,d.modifiers.bodyScale);
    massScale*=d.modifiers.massMultiplier**s.stacks;
    meleeScale*=d.modifiers.meleeHitboxScale**s.stacks;
    if(d.reflect) reflectExtra=Math.max(reflectExtra??0,d.reflect.extraRadius);
  }
  return {radius:base.body.radius*Math.min(3,bodyScale),mass:base.body.mass*Math.max(.1,Math.min(3,massScale)),meleeScale:Math.max(.1,Math.min(3,meleeScale)),reflectExtra};
}
export function speedImpactDamage(content: ContentBundle, characterId: string, abilityId: string, damage: number, relativeSpeed: number): number {
  const char=content.source.characters.find(c=>c.id===characterId)!;
  const ability=content.source.abilities.find(a=>a.id===abilityId)!;
  const passive=content.source.passives.find(p=>char.passiveIds.includes(p.id)&&p.id==='speed-impact');
  if(!passive || ability.ai.predictorId!=='dash-hit') return damage;
  const fx=passive.effects[0]!;
  if(fx.kind!=='plugin') throw new Error('Invalid speed-impact definition');
  const bonus=Math.max(0,Math.min(Number(fx.params['maxBonus']),(relativeSpeed-Number(fx.params['thresholdSpeed']))/Number(fx.params['speedScale'])));
  return damage*(1+bonus);
}
export function reflectVelocity(velocity: Vec2, normal: Vec2): Vec2 {
  const length=Math.hypot(normal.x,normal.y), speed=Math.hypot(velocity.x,velocity.y);
  const nx=length>1e-9?normal.x/length:(speed? -velocity.x/speed:1),ny=length>1e-9?normal.y/length:(speed? -velocity.y/speed:0);
  const dot=velocity.x*nx+velocity.y*ny;
  return {x:velocity.x-2*dot*nx,y:velocity.y-2*dot*ny};
}
