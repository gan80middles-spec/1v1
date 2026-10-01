import type { FighterConfig, FighterResult, FighterWorld, WorldView } from '../contracts/fighter.js';
import type { ContentBundle } from '../contracts/content.js';
export interface Ruleset {
  id:FighterConfig['rulesetId']; version:1;
  initialize(entities:FighterWorld['entities'],config:FighterConfig,content:ContentBundle):void;
  capabilities():Readonly<{jump:boolean;horizontalMove:boolean}>;
  evaluateResult(state:WorldView):FighterResult|null;
}
function result(w:WorldView):FighterResult|null {
  if(!w.entities.some(e=>e.hp<=0)&&w.tick<w.config.maxTicks)return null;
  const [a,b]=w.entities,both=a.hp<=0&&b.hp<=0,dead=a.hp<=0||b.hp<=0,difference=a.hp*b.maxHp-b.hp*a.maxHp;
  const winner=both?null:dead?(a.hp>0?a:b).participantId:Math.abs(difference)<=.005*a.maxHp*b.maxHp?null:(difference>0?a:b).participantId;
  return {matchId:w.config.matchId,reason:both?'double-ko':dead?'ko':'timeout',winnerParticipantId:winner,endedAfterTicks:w.tick,remainingHp:[a.hp,b.hp],diagnosticCode:null};
}
const fighter:Ruleset={id:'fighter',version:1,initialize:()=>{},capabilities:()=>({jump:true,horizontalMove:true}),evaluateResult:result};
const freeBounce:Ruleset={id:'free-bounce-fixture',version:1,initialize:(entities,config,content)=>{
  const arena=content.source.arenas.find(a=>a.id===config.arenaId)!;
  if(arena.gravity.x!==0||arena.gravity.y!==0)throw new Error('FreeBounceFixture requires zero gravity');
  const velocities=[{x:420,y:310},{x:-370,y:-260}];
  for(let i=0;i<2;i++){const body=entities[i]!.body;body.position={...arena.spawnPositions[i]!};body.velocity={...velocities[i]!};body.grounded=false;}
},capabilities:()=>({jump:false,horizontalMove:true}),evaluateResult:result};
export function rulesetFor(id:FighterConfig['rulesetId']):Ruleset {return id==='fighter'?fighter:freeBounce;}
