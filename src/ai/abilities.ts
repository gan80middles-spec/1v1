import type { ContentBundle } from '../contracts/content.js';
import type { AIProfile } from '../contracts/content-schema.js';
import type { Observation, PublicFighter } from '../contracts/fighter.js';
import type { MotionParams } from '../contracts/ai.js';
import type { Slot } from '../contracts/versions.js';
export const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
export const direction = (n: number, fallback: -1 | 1 = 1): -1 | 1 => n === 0 ? fallback : n > 0 ? 1 : -1;
export function abilityFor(content: ContentBundle, characterId: string, slot: Slot) { const c = content.source.characters.find(c => c.id === characterId)!; return content.source.abilities.find(a => a.id === c.slots[slot])!; }
export function attributes(content: ContentBundle, fighter: Observation['self']['entity'] | PublicFighter, tick: number): MotionParams {
    const c = content.source.characters.find(c => c.id === fighter.characterId)!;
    const value: MotionParams = { ...c.body, damageTaken: 1, knockbackTaken: 1, wallGrowth: .04 };
    const statuses = 'statuses' in fighter ? fighter.statuses.filter(s => s.expiresTick > tick).map(s => ({ id: s.definitionId, stacks: s.stacks })) : fighter.visibleStatusIds.map(id => ({ id, stacks: 1 }));
    for (const s of statuses) {
        const m = content.source.statuses.find(d => d.id === s.id)!.modifiers;
        value.damageTaken *= m.damageTakenMultiplier ** s.stacks;
        value.knockbackTaken *= m.knockbackTakenMultiplier ** s.stacks;
        value.moveSpeed *= m.moveSpeedMultiplier ** s.stacks;
        value.jumpSpeed *= m.jumpSpeedMultiplier ** s.stacks;
        if (m.restitutionOverride !== null)
            value.restitution = m.restitutionOverride;
        if (m.wallGrowthCoefficientOverride !== null)
            value.wallGrowth = m.wallGrowthCoefficientOverride;
    }
    value.damageTaken = Math.max(0, Math.min(2, value.damageTaken));
    value.knockbackTaken = Math.max(.1, Math.min(3, value.knockbackTaken));
    value.moveSpeed = Math.max(c.body.moveSpeed * .1, Math.min(c.body.moveSpeed * 3, value.moveSpeed));
    value.jumpSpeed = Math.max(c.body.jumpSpeed * .1, Math.min(c.body.jumpSpeed * 3, value.jumpSpeed));
    return value;
}
export function distanceBand(o: Observation, content: ContentBundle, profile: AIProfile, quietTicks = 0, threatened = false): readonly [
    number,
    number
] {
    const ranged = profile.distancePreference !== 'melee' && o.self.legalSlots.find(s => abilityFor(content, o.self.entity.characterId, s).tags.includes('projectile'));
    const band = abilityFor(content, o.self.entity.characterId, ranged || 'basic').ai.preferredCenterDistance;
    const shrink = threatened ? 1 : 1 - .3 * clamp01((quietTicks - 180) / 180);
    return [band[0] * shrink, band[1] * shrink];
}
export function positionQuality(self: {
    position: {
        x: number;
        y: number;
    };
    radius: number;
}, opponent: {
    position: {
        x: number;
        y: number;
    };
}, width: number, band: readonly [
    number,
    number
], rubber = false): number {
    const d = Math.hypot(self.position.x - opponent.position.x, self.position.y - opponent.position.y), [lo, hi] = band;
    const fit = d < lo ? clamp01(1 - (lo - d) / 160) : d > hi ? clamp01(1 - (d - hi) / 160) : 1;
    const space = clamp01(Math.min(self.position.x - self.radius, width - self.radius - self.position.x) / 160), height = clamp01(1 - Math.abs(self.position.y - opponent.position.y) / 220);
    return rubber ? (.65 / .8 * .95) * fit + .05 * space + (.15 / .8 * .95) * height : .65 * fit + .2 * space + .15 * height;
}
