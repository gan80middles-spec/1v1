import type { ContentBundle } from '../contracts/content.js';
import type { Observation } from '../contracts/fighter.js';
import type { Belief, Option } from '../contracts/ai.js';
import { SLOTS } from '../contracts/versions.js';
import { actionPhase } from '../math/fighter-phase.js';
import { abilityFor, direction } from './abilities.js';
export function generateOptions(o: Observation, content: ContentBundle, belief: Belief): Option[] {
    if (!o.self.canMove || ['dead', 'hitstun'].includes(actionPhase(o.self.entity, o.nowTick)))
        return [];
    const aimX = direction((belief.opponent?.position.x ?? o.self.entity.body.position.x) - o.self.entity.body.position.x, o.self.entity.body.facing), moves: readonly (-1 | 0 | 1)[] = o.capabilities.horizontalMove ? [-1, 0, 1] : [0], options: Option[] = [];
    for (const moveX of moves) {
        const tag = moveX === 0 ? 'wait' : moveX === aimX ? 'approach' : 'retreat';
        options.push({ key: `move:${tag}:${moveX}`, kind: 'move', moveX, slot: null, aimX, legal: true, reason: null, tag });
    }
    if (!belief.opponent) {
        const target=o.arena.width/2+(o.self.entity.id===1?-o.self.entity.body.radius:o.self.entity.body.radius),delta=target-o.self.entity.body.position.x;
        const entryMove=o.capabilities.horizontalMove&&Math.abs(delta)>=10?direction(delta):0;
        return options.filter(option=>option.moveX===entryMove);
    }
    for (const moveX of moves)
        options.push({ key: `jump:${moveX}`, kind: 'jump', moveX, slot: null, aimX, legal: o.self.canJump && o.capabilities.jump, reason: o.self.canJump && o.capabilities.jump ? null : 'jump-unavailable', tag: 'evade' });
    for (const slot of SLOTS) {
        const a = abilityFor(content, o.self.entity.characterId, slot);
        for (const moveX of a.movementScale === 0 ? [0 as const] : moves) {
            const phase = actionPhase(o.self.entity, o.nowTick), legal = o.self.legalSlots.includes(slot), reason = legal ? null : phase !== 'free' ? 'busy' : o.self.entity.cooldownReadyTick[slot] > o.nowTick ? 'cooldown' : o.self.entity.energy < a.energyCost ? 'resource' : 'condition';
            options.push({ key: `cast:${slot}:${moveX}:${aimX}`, kind: 'cast', moveX, slot, aimX, legal, reason, tag: slot === 'ultimate' ? 'commit-ultimate' : belief.opponent.tell?.phase === 'recovery' ? 'punish' : 'attack' });
        }
    }
    return options.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
