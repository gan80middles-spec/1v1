import {readFileSync} from 'node:fs';
import {describe, it, expect} from 'vitest';
import type {ContentSource} from '../src/contracts/content-schema.js';
import type {FighterWorld} from '../src/contracts/fighter.js';
import {compilePhase3BContent} from '../src/content/phase3b.js';
import {fighterConfig} from '../src/runner/fighter.js';
import {FighterSimulation} from '../src/sim/fighter.js';
import {initialFighterState} from '../src/sim/fighter-state.js';
import {ObservationBuffer} from '../src/runner/observation.js';
import {buildBelief} from '../src/ai/belief.js';
import {emptyMemory} from '../src/ai/memory.js';
import {UtilityRunner} from '../src/runner/utility.js';
import {replayInputs} from '../src/runner/input-replay.js';
import {NEUTRAL_INTENT} from '../src/contracts/state.js';
import {deriveParticipantSeed} from '../src/math/random.js';

const source=JSON.parse(readFileSync('content/fighter-window.json','utf8')) as ContentSource;
const content=compilePhase3BContent(source);
const settings={noise:false,randomChoice:false,memory:true};

describe('delay-gap contact prediction',()=>{
  it('extrapolates a real dash trade from delayed public data and own history without seeing the new enemy position',()=>{
    const raw=structuredClone(source);for(const p of raw.profiles){p.reactionDelayTicks=12;p.positionNoisePx=0;p.velocityNoisePxPerSecond=0;}
    const c=compilePhase3BContent(raw),cfg=fighterConfig(c,17,'rubber','rubber');
    const w=structuredClone(initialFighterState(cfg,c,'phase3b-v1')) as FighterWorld;
    w.entities[0].body.position.x=304;w.entities[1].body.position.x=672;
    const sim=new FighterSimulation(c,cfg,w,'phase3b-v1'),buffer=new ObservationBuffer(c),memory=emptyMemory();
    let ownCastId=0;
    memory.ownMotionHistory=[];buffer.push(sim.snapshot(),[],[]);
    while(sim.snapshot().tick<42){
      const before=sim.snapshot(),self=before.entities[0];
      memory.ownMotionHistory.push({tick:before.tick,body:structuredClone(self.body),castId:self.action.kind==='cast'?self.action.castId:null});
      const t=before.tick,intents=t===18?[{...NEUTRAL_INTENT,requestId:1,cast:{slot:'skill1' as const,aimX:1 as const}},
        {...NEUTRAL_INTENT,requestId:1,cast:{slot:'skill1' as const,aimX:-1 as const}}]:[NEUTRAL_INTENT,NEUTRAL_INTENT];
      const out=sim.step(intents as [typeof intents[number],typeof intents[number]]);buffer.push(out.state,out.events,out.receipts);
      for(const event of out.events)if(event.type==='CastAccepted'&&event.sourceId===1)ownCastId=event.payload.castId;
    }
    const world=sim.snapshot(),o=buffer.observe(world,0),profile=c.source.profiles.find(p=>p.id===cfg.participants[0].profileId)!;
    expect(ownCastId).toBeGreaterThan(0);
    memory.pendingOwnResults=[{requestId:1,castId:ownCastId,slot:'skill1',abilityId:'rubber-dash',startedTick:18,aimX:1,
      startPosition:{x:304,y:32},finalEffectTick:48,resultDueTick:60,effective:null,accepted:true,finished:true}];
    const modern=buildBelief(o,c,profile,memory,17,settings),legacy=buildBelief(o,c,{...profile,predictionModel:'causal-v1'},memory,17,settings);
    const real=world.entities[1].body.position,error=(p:{x:number;y:number})=>Math.hypot(p.x-real.x,p.y-real.y);
    expect(error(legacy.opponent!.position)).toBeGreaterThan(150);
    expect(error(modern.opponent!.position)).toBeLessThan(25);
    expect(modern.opponent!.velocity.x).toBeGreaterThan(0);
    expect(modern.opponent!.tell).toBeNull();
    const alreadyKnown=structuredClone(memory);alreadyKnown.pendingOwnResults[0]!.effective='hit';
    expect(buildBelief(o,c,profile,alreadyKnown,17,settings).opponent!.tell).not.toBeNull();
  });
  it('checkpoints preserve bounded own-history and all future inputs across the first collision',()=>{
    const cfg=fighterConfig(content,17,'rubber','rubber',360),a=new UtilityRunner(content,cfg,{recordFrames:false});
    for(let t=0;t<32;t++)a.step();
    const cp=JSON.parse(JSON.stringify(a.snapshot(true))),b=new UtilityRunner(content,cfg,{recordFrames:false});b.restore(cp);
    expect(cp.aiVersion).toBe('utility-v5');
    for(const c of cp.controllers)if(c.kind==='utility')expect(c.data.memory.ownMotionHistory.length).toBeLessThanOrEqual(19);
    expect(()=>b.restore({...cp,aiVersion:'utility-v4'})).toThrow();
    while(!a.sim.snapshot().result){a.step();b.step();expect(a.inputs.at(-1)).toEqual(b.inputs.at(-1));}
    expect(a.runnerHash()).toBe(b.runnerHash());expect(a.replay()).toEqual(b.replay());
    expect(replayInputs(a.replay(),false).replay.finalWorldHash).toBe(a.replay().finalWorldHash);
  },30000);
  it('own history cannot reveal a changed hidden enemy before the observation delay',()=>{
    const cfg=fighterConfig(content),base=structuredClone(initialFighterState(cfg,content,'phase3b-v1')) as FighterWorld;
    const a=new ObservationBuffer(content),b=new ObservationBuffer(content);a.push(base,[],[]);b.push(base,[],[]);
    const profile=content.source.profiles.find(p=>p.id===cfg.participants[0].profileId)!,memory=emptyMemory();
    memory.ownMotionHistory=[{tick:0,body:structuredClone(base.entities[0].body),castId:null}];
    for(let t=1;t<profile.reactionDelayTicks;t++){
      const x=structuredClone(base);x.tick=t;const y=structuredClone(x);y.entities[1].body.position.x=100;y.entities[1].cooldownReadyTick.basic=999;
      a.push(x,[],[]);b.push(y,[],[]);expect(buildBelief(a.observe(x,0),content,profile,memory,17,settings)).toEqual(buildBelief(b.observe(y,0),content,profile,memory,17,settings));
    }
  });
  it('mixed control versions and swapped sides preserve participant RNG identities',()=>{
    const mixed=structuredClone(source),old=structuredClone(mixed.profiles[0]!);old.id='fixed-v4';old.predictionModel='causal-v1';old.version--;
    mixed.profiles.push(old);const c=compilePhase3BContent(mixed),cfg=fighterConfig(c,19,'standard','rubber');
    cfg.participants[0].profileId='fixed-v4';cfg.participants[0].participantId='P';cfg.participants[1].participantId='Q';
    const runner=new UtilityRunner(c,cfg,{trace:true});runner.run();
    expect(runner.aiVersion).toBe('utility-v5');expect(runner.traces.filter(t=>t.entityId===1).every(t=>t.trace.aiVersion==='utility-v4')).toBe(true);
    expect(runner.traces.filter(t=>t.entityId===2).every(t=>t.trace.aiVersion==='utility-v5')).toBe(true);
    expect(deriveParticipantSeed(cfg.seed,'P')).not.toBe(deriveParticipantSeed(cfg.seed,'Q'));
  });
});
