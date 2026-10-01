import type { PredictionContext } from './prediction.js';
import type { Option, OutcomeEstimate } from '../contracts/ai.js';
import { abilityFor, distanceBand, positionQuality } from './abilities.js';
/** Ablation: current-position rules, with no trajectory or future threat integration. */
export function staticOutcome(c:PredictionContext,option:Option):OutcomeEstimate {
  const o=c.observation,self=o.self.entity,enemy=c.belief.opponent,band=distanceBand(o,c.content,c.profile);
  const outcome:OutcomeEstimate={expectedDamageDealtPct:0,meanDamageTakenPct:0,worstDamageTakenPct:0,killLikelihood:0,deathLikelihood:0,positionQualityBefore:0,positionQualityAfter:0,bandProgressPx:0,residualExposurePct:0,setupValue:0,confidence:c.belief.confidence,earlyRiskPct:0,hitTicks:[],segmentsUsed:0,budgetExceeded:false,setupConfidence:.6,setupReason:'prediction-disabled: current geometry only'};
  if(!enemy)return outcome;
  const dx=enemy.position.x-self.body.position.x,dy=enemy.position.y-self.body.position.y,distance=Math.hypot(dx,dy),quality=positionQuality(self.body,enemy,o.arena.width,band);
  outcome.positionQualityBefore=quality;outcome.positionQualityAfter=quality;
  const approach=option.moveX*Math.sign(dx),bandError=distance>band[1]?1:distance<band[0]?-1:0;
  outcome.positionQualityAfter=Math.max(0,Math.min(1,quality+approach*bandError*.05));outcome.bandProgressPx=distance>band[1]?approach*12:0;
  if(option.kind==='cast')for(const e of abilityFor(c.content,self.characterId,option.slot!).timeline)for(const fx of e.effects){
    const targetMax=c.content.source.characters.find(x=>x.id===enemy.characterId)!.stats.maxHp;
    if(fx.kind==='hitbox'&&Math.hypot(dx-fx.offset.x*option.aimX,dy-fx.offset.y)<=fx.radius+enemy.radius||fx.kind==='projectile'&&Math.sign(dx)===option.aimX&&Math.abs(dy-8)<fx.radius+enemy.radius)outcome.expectedDamageDealtPct+=('hit'in fx?fx.hit.damage:0)*100/targetMax;
  }
  const basic=abilityFor(c.content,enemy.characterId,'basic'),near=basic.timeline.flatMap(t=>t.effects).find(f=>f.kind==='hitbox');
  if(near?.kind==='hitbox'&&distance<Math.abs(near.offset.x)+near.radius+self.body.radius)outcome.meanDamageTakenPct=outcome.worstDamageTakenPct=near.hit.damage*100/self.maxHp*.35;
  outcome.earlyRiskPct=outcome.meanDamageTakenPct;return outcome;
}
