import type { ContentBundle } from '../../contracts/content.js';
import type { FighterEntity, WorldView, ReceiptReason } from '../../contracts/fighter.js';
import type { Slot } from '../../contracts/versions.js';
import type { Material } from '../physics/motion.js';
import { statusGeometry } from '../../math/ability-effects.js';
import { actionPhase } from '../../math/fighter-phase.js';
export const phaseAt = actionPhase;
export function effective(entity: WorldView['entities'][number], content: ContentBundle, tick: number): Material {
    const character = content.source.characters.find((item) => item.id === entity.characterId);
    if (!character)
        throw new Error(`Unknown character ${entity.characterId}`);
    const value: Material = { restitution: character.body.restitution, moveSpeed: character.body.moveSpeed, groundAcceleration: character.body.groundAcceleration, airAcceleration: character.body.airAcceleration, jumpSpeed: character.body.jumpSpeed, damageTaken: 1, knockbackTaken: 1, meleeScale: 1, wallGrowth: .04 };
    const passive = content.source.passives.find(p => character.passiveIds.includes(p.id) && p.id === 'rubber-wall-growth');
    if (passive?.effects[0]?.kind === 'plugin')
        value.wallGrowth = Number(passive.effects[0].params['growthCoefficient']);
    for (const instance of [...entity.statuses].filter((status) => status.expiresTick > tick).sort((a, b) => a.appliedTick - b.appliedTick || a.instanceId - b.instanceId)) {
        const status = content.source.statuses.find((item) => item.id === instance.definitionId);
        if (!status)
            throw new Error(`Unknown status ${instance.definitionId}`);
        const m = status.modifiers;
        value.damageTaken *= m.damageTakenMultiplier ** instance.stacks;
        value.knockbackTaken *= m.knockbackTakenMultiplier ** instance.stacks;
        value.moveSpeed *= m.moveSpeedMultiplier ** instance.stacks;
        value.jumpSpeed *= m.jumpSpeedMultiplier ** instance.stacks;
        value.meleeScale *= m.meleeHitboxScale ** instance.stacks;
        if (m.restitutionOverride !== null)
            value.restitution = m.restitutionOverride;
        if (m.wallGrowthCoefficientOverride !== null)
            value.wallGrowth = m.wallGrowthCoefficientOverride;
    }
    value.damageTaken = Math.max(0, Math.min(2, value.damageTaken));
    value.knockbackTaken = Math.max(.1, Math.min(3, value.knockbackTaken));
    value.meleeScale = Math.max(.1, Math.min(3, value.meleeScale));
    value.moveSpeed = Math.max(character.body.moveSpeed * .1, Math.min(character.body.moveSpeed * 3, value.moveSpeed));
    value.jumpSpeed = Math.max(character.body.jumpSpeed * .1, Math.min(character.body.jumpSpeed * 3, value.jumpSpeed));
    return value;
}
export function applyBodyAttributes(entity: FighterEntity, content: ContentBundle, tick: number, arena: {
    width: number;
    height: number;
}): void {
    const geometry=statusGeometry(content,entity.characterId,entity.statuses,tick);
    entity.body.radius=geometry.radius;entity.body.mass=geometry.mass;
    entity.body.position.x = Math.max(entity.body.radius, Math.min(arena.width - entity.body.radius, entity.body.position.x));
    entity.body.position.y = Math.max(entity.body.radius, Math.min(arena.height - entity.body.radius, entity.body.position.y));
}
export function castRejection(entity: WorldView['entities'][number], slot: Slot, content: ContentBundle, tick: number): ReceiptReason | null {
    const phase = phaseAt(entity, tick);
    if (phase === 'dead')
        return 'dead';
    if (phase === 'hitstun')
        return 'hitstun';
    if (phase !== 'free')
        return 'busy';
    if (entity.cooldownReadyTick[slot] > tick)
        return 'cooldown';
    const character = content.source.characters.find((item) => item.id === entity.characterId)!;
    const ability = content.source.abilities.find((item) => item.id === character.slots[slot])!;
    if (entity.energy < ability.energyCost)
        return 'resource';
    if ((ability.allowedWhen === 'ground' && !entity.body.grounded) || (ability.allowedWhen === 'air' && entity.body.grounded))
        return 'air-ground';
    for (const condition of ability.conditions) {
        if (condition.kind === 'grounded' && entity.body.grounded !== condition.value)
            return 'condition';
        if (condition.kind === 'hpBelow' && entity.hp / entity.maxHp >= condition.ratio)
            return 'condition';
        if (condition.kind === 'hasStatus' && !entity.statuses.some((s) => s.definitionId === condition.statusId && s.expiresTick > tick))
            return 'condition';
    }
    return null;
}
