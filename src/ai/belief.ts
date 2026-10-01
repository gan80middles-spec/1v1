import type { ContentBundle } from '../contracts/content.js';
import type { AIProfile } from '../contracts/content-schema.js';
import type { Observation } from '../contracts/fighter.js';
import type { AIMemory, Belief, MotionState, UtilitySettings } from '../contracts/ai.js';
import { decisionChannel } from '../math/decision-random.js';
import { advanceMotion } from './motion.js';
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
    for (let tick = 0; tick < advance; tick += 6)
        advanceMotion(body, params, move, Math.min(6, advance - tick), o.arena);
    const opponent = { ...seen, position: { ...body.position }, velocity: { ...body.velocity }, grounded: body.grounded }, toward = direction(o.self.entity.body.position.x - body.position.x, seen.facing), adapt = adaptiveWeights(memory, contextAt(o), settings.memory);
    const confidence = !settings.noise && profile.reactionDelayTicks === 0 ? 1 : age > 18 ? .5 : age <= 9 ? .95 : .95 - (age - 9) / 9 * .25;
    return { opponent, age, confidence, offsets, hypotheses: [{ kind: 'keep', moveX: move, weight: adapt.weights[0] }, { kind: 'approach', moveX: toward, weight: adapt.weights[1] }, { kind: 'retreat', moveX: toward === 1 ? -1 : 1, weight: adapt.weights[2] }], adapted: adapt.adapted };
}
