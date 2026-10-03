import type { ContentBundle } from '../contracts/content.js';
import type { AIProfile } from '../contracts/content-schema.js';
import type { Observation } from '../contracts/fighter.js';
import type { AIMemory, Belief, MotionState, UtilitySettings } from '../contracts/ai.js';
import { decisionChannel } from '../math/decision-random.js';
import { advanceMotion, resolvePredictedContact } from './motion.js';
import { limitVelocity, sweepCircles } from '../math/geometry.js';
import { adaptiveWeights, contextAt } from './memory.js';
import { attributes, direction } from './abilities.js';
export function buildBelief(o: Observation, content: ContentBundle, profile: AIProfile, memory: AIMemory, bits: number, settings: UtilitySettings): Belief {
    const offsets = { x: 0, y: 0, vx: 0, vy: 0 };
    if (settings.noise) {
        offsets.x = (decisionChannel(bits, 2) * 2 - 1) * profile.positionNoisePx;
        offsets.y = (decisionChannel(bits, 3) * 2 - 1) * profile.positionNoisePx;
        offsets.vx = (decisionChannel(bits, 4) * 2 - 1) * profile.velocityNoisePxPerSecond;
        offsets.vy = (decisionChannel(bits, 5) * 2 - 1) * profile.velocityNoisePxPerSecond;
    }
    if (!o.opponent || o.sensedTick === null)
        return { opponent: null, age: null, confidence: 0, offsets, hypotheses: [], adapted: false };
    const seen = o.opponent, age = o.nowTick - o.sensedTick, body: MotionState = { position: { x: seen.position.x + offsets.x, y: seen.position.y + offsets.y }, velocity: { x: seen.velocity.x + offsets.vx, y: seen.velocity.y + offsets.vy }, radius: seen.radius, mass: content.source.characters.find(c => c.id === seen.characterId)!.body.mass, grounded: seen.grounded, facing: seen.facing };
    body.position.x = Math.max(body.radius, Math.min(o.arena.width - body.radius, body.position.x));
    body.position.y = Math.max(body.radius, Math.min(o.arena.height - body.radius, body.position.y));
    const move = Math.abs(seen.velocity.x) < 10 ? 0 : direction(seen.velocity.x), params = attributes(content, seen, o.nowTick);
    if (seen.tell) {
        const ability = content.source.abilities.find(a => a.id === seen.tell!.abilityId)!;
        params.moveSpeed *= ability.movementScale;
    }
    const advance = Math.min(18, Math.max(0, age));
    let inferredInterrupted = false;
    if (profile.predictionModel === 'window-v1') {
        const ability = seen.tell ? content.source.abilities.find(a=>a.id===seen.tell!.abilityId)! : null;
        const ownByTick = new Map((memory.ownMotionHistory??[]).map(s=>[s.tick,s.body]));
        const ownSamples = new Map((memory.ownMotionHistory??[]).map(s=>[s.tick,s]));
        const hitGroups = new Set<string>();
        let stunUntil = 0;
        for (let tick = 0; tick < advance; tick++) {
            const sourceTick = o.sensedTick + tick, elapsed = seen.tell ? sourceTick-seen.tell.visibleSinceTick : 0;
            const stepParams = attributes(content,seen,sourceTick);
            let stepMove: -1|0|1|null = move;
            if (sourceTick < stunUntil) stepMove=null;
            else if (ability && !inferredInterrupted && elapsed < ability.startupTicks+ability.activeTicks+ability.recoveryTicks) {
                stepParams.moveSpeed *= ability.movementScale;
                if (ability.movementScale===0 || ability.tags.includes('mobility') && elapsed>=ability.startupTicks && elapsed<ability.startupTicks+ability.activeTicks) stepMove=null;
                for (const entry of ability.timeline) if (entry.offsetTick===elapsed) for (const fx of entry.effects) if (fx.kind==='impulse') {
                    if (fx.velocityMode==='set-x') body.velocity.x=fx.deltaV.x*seen.facing;
                    else body.velocity.x+=fx.deltaV.x*seen.facing;
                    body.velocity.y+=fx.deltaV.y; limitVelocity(body.velocity);
                }
            }
            const from = {...body.position}, previousOwn = ownByTick.get(sourceTick), nextOwn = ownByTick.get(sourceTick+1);
            advanceMotion(body,stepParams,stepMove,1,o.arena);
            if (previousOwn && nextOwn) {
                // Own measured history is already available to this controller.
                // Do not read a newer opponent snapshot or simulate future inputs.
                const own = {...previousOwn,position:{...nextOwn.position},velocity:{...previousOwn.velocity}};
                resolvePredictedContact(own,body,previousOwn.position,from,1/60,
                    Math.min(attributes(content,o.self.entity,sourceTick).restitution,stepParams.restitution));
                body.position.x=Math.max(body.radius,Math.min(o.arena.width-body.radius,body.position.x));
                body.position.y=Math.max(body.radius,Math.min(o.arena.height-body.radius,body.position.y));
                let launchX=0,launchY=0,stun=0,contact=false;
                for (const pending of memory.pendingOwnResults) {
                    if(!pending.accepted||pending.castId===null||pending.effective==='hit'||ownSamples.get(sourceTick)?.castId!==pending.castId) continue;
                    const a=content.source.abilities.find(a=>a.id===pending.abilityId)!;
                    for(const entry of a.timeline)for(const fx of entry.effects){
                        if(fx.kind!=='hitbox')continue;
                        const born=pending.startedTick+entry.offsetTick,key=`${pending.castId}:${fx.hit.hitGroup}`;
                        if(sourceTick<born||sourceTick>=born+fx.durationTicks||hitGroups.has(key))continue;
                        const offset=(p:{x:number;y:number})=>({x:p.x+fx.offset.x*pending.aimX,y:p.y+fx.offset.y});
                        if(sweepCircles(offset(previousOwn.position),offset(nextOwn.position),fx.radius,from,body.position,body.radius)===null)continue;
                        hitGroups.add(key);contact=true;launchX+=fx.hit.launchDeltaV.x*pending.aimX/body.mass*stepParams.knockbackTaken;
                        launchY+=fx.hit.launchDeltaV.y/body.mass*stepParams.knockbackTaken;stun=Math.max(stun,fx.hit.hitstunTicks);
                    }
                }
                if(contact){
                    body.velocity.x=body.velocity.x*.25+launchX;body.velocity.y=body.velocity.y*.25+launchY;
                    body.grounded=false;limitVelocity(body.velocity);
                    if(stun>0){inferredInterrupted=true;stunUntil=Math.max(stunUntil,sourceTick+1+stun);}
                }
            }
        }
    } else for (let tick = 0; tick < advance; tick += 6)
        advanceMotion(body, params, move, Math.min(6, advance - tick), o.arena);
    const opponent = { ...seen, ...(inferredInterrupted?{tell:null}:{}), position: { ...body.position }, velocity: { ...body.velocity }, grounded: body.grounded }, toward = direction(o.self.entity.body.position.x - body.position.x, seen.facing), adapt = adaptiveWeights(memory, contextAt(o), settings.memory);
    const confidence = !settings.noise && profile.reactionDelayTicks === 0 ? 1 : age > 18 ? .5 : age <= 9 ? .95 : .95 - (age - 9) / 9 * .25;
    return { opponent, age, confidence, offsets, hypotheses: [{ kind: 'keep', moveX: move, weight: adapt.weights[0] }, { kind: 'approach', moveX: toward, weight: adapt.weights[1] }, { kind: 'retreat', moveX: toward === 1 ? -1 : 1, weight: adapt.weights[2] }], adapted: adapt.adapted };
}
