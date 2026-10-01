import { z } from 'zod';
import { CONTENT_SCHEMA_VERSION, PREDICTOR_IDS } from './versions.js';

const finite = z.number().finite();
const id = z.string().regex(/^[a-z][a-z0-9-]*$/);
const tick = z.number().int().min(0).max(3600);
const duration = tick.min(1);
const ratio = finite.min(0).max(1);
const multiplier = finite.min(0.1).max(3);
export const Vec2Schema = z.strictObject({ x: finite, y: finite });
const HitSchema = z.strictObject({
  damage: finite.min(0).max(100), launchDeltaV: z.strictObject({ x: finite.min(-1800).max(1800), y: finite.min(-1800).max(1800) }),
  hitstunTicks: tick.max(240), hitGroup: id,
});
const EffectSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('hitbox'), radius: finite.min(1).max(240), offset: Vec2Schema, durationTicks: duration, hit: HitSchema }),
  z.strictObject({ kind: z.literal('projectile'), radius: finite.min(8).max(120), speed: finite.min(0).max(1800), lifetimeTicks: duration.max(360), reflectable: z.boolean(), hit: HitSchema }),
  z.strictObject({ kind: z.literal('impulse'), deltaV: z.strictObject({ x: finite.min(-1800).max(1800), y: finite.min(-1800).max(1800) }), target: z.enum(['self','hitTarget']), velocityMode: z.enum(['add','set-x']).optional() }),
  z.strictObject({ kind: z.literal('status'), statusId: id, target: z.enum(['self','hitTarget']) }),
  z.strictObject({ kind: z.literal('heal'), amount: finite.min(0).max(100), target: z.literal('self') }),
  z.strictObject({ kind: z.literal('plugin'), pluginId: id, params: z.record(z.string(), z.union([finite,z.string(),z.boolean()])) }),
]);
const ConditionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('grounded'), value: z.boolean() }),
  z.strictObject({ kind: z.literal('hpBelow'), ratio }),
  z.strictObject({ kind: z.literal('hasStatus'), statusId: id }),
]);
const CharacterSchema = z.strictObject({
  id, version: z.number().int().min(1), name: z.string().min(1), ruleText: z.string().min(1),
  body: z.strictObject({
    radius: finite.min(24).max(96), mass: finite.min(0.1).max(10), restitution: finite.min(0).max(1.15),
    moveSpeed: finite.min(0).max(1800), groundAcceleration: finite.min(0).max(10000),
    airAcceleration: finite.min(0).max(10000), jumpSpeed: finite.min(0).max(1800),
  }),
  stats: z.strictObject({ maxHp: finite.min(1).max(1000) }),
  slots: z.strictObject({ basic: id, skill1: id, skill2: id, ultimate: id }),
  passiveIds: z.array(id).max(8), aiProfileId: id,
  visual: z.strictObject({ shape: z.enum(['circle','square','triangle','hexagon']), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), outlineColor: z.string().regex(/^#[0-9a-fA-F]{6}$/) }),
});
const AbilitySchema = z.strictObject({
  id, version: z.number().int().min(1), tags: z.array(z.enum(['melee','projectile','mobility','defense','buff'])).max(5),
  allowedWhen: z.enum(['ground','air','both']), startupTicks: tick, activeTicks: duration, recoveryTicks: tick,
  cooldownTicks: tick, energyCost: finite.min(0).max(100), movementScale: finite.min(0).max(1),
  conditions: z.array(ConditionSchema).max(8),
  scheduledPolicy: z.enum(['cancel-on-interrupt','before-first-emission']).optional(),
  timeline: z.array(z.strictObject({ offsetTick: tick, effects: z.array(EffectSchema).min(1).max(32) })).max(64),
  ai: z.strictObject({
    predictorId: z.enum(PREDICTOR_IDS), preferredCenterDistance: z.tuple([finite.min(0).max(1400),finite.min(0).max(1400)]),
    purpose: z.enum(['damage','defense','mobility','setup']),
  }),
});
const StatusSchema = z.strictObject({
  id, version: z.number().int().min(1), durationTicks: duration, stacking: z.enum(['refresh','replace','stack']), maxStacks: z.number().int().min(1).max(8),
  modifiers: z.strictObject({
    damageTakenMultiplier: finite.min(0).max(2), knockbackTakenMultiplier: multiplier,
    moveSpeedMultiplier: multiplier, jumpSpeedMultiplier: multiplier, massMultiplier: multiplier,
    bodyScale: multiplier, meleeHitboxScale: multiplier,
    restitutionOverride: finite.min(0).max(1.15).nullable(), wallGrowthCoefficientOverride: finite.min(0).max(0.1).nullable(),
  }),
  reflect: z.strictObject({ extraRadius: finite.min(0).max(96) }).nullable(),
});
const PassiveSchema = z.strictObject({
  id, trigger: z.enum(['wallBounce','damageDealt','damageTaken']), internalCooldownTicks: tick,
  conditions: z.array(ConditionSchema).max(8), effects: z.array(EffectSchema).min(1).max(32),
});
const ProfileSchema = z.strictObject({
  id, version: z.number().int().min(1), aggression: ratio, riskPreference: ratio, spacing: ratio, resourcePatience: ratio,
  reactionDelayTicks: tick.max(30), decisionIntervalTicks: tick.min(3).max(12),
  positionNoisePx: finite.min(0).max(64), velocityNoisePxPerSecond: finite.min(0).max(180), nearBestBand: finite.min(0).max(1.5),
  distancePreference: z.enum(['melee','mixed','ranged']),
});
const PacingProfileSchema = z.strictObject({
  id, version: z.number().int().min(1), sampleIntervalTicks: duration.max(60), initialQuietTicks: tick,
  noInteractionThresholdTicks: duration, repeatedMissThreshold: z.number().int().min(1).max(12), readyHoldThresholdTicks: duration,
  cueDurationTicks: duration.max(600), rampTicks: duration.max(300), neutralBetweenCuesTicks: duration, maxCuesPerMatch: z.number().int().min(0).max(6),
});
const ArenaSchema = z.strictObject({
  id, version: z.number().int().min(1), width: finite.min(192).max(4096), height: finite.min(192).max(4096),
  gravity: Vec2Schema, spawnPositions: z.tuple([Vec2Schema,Vec2Schema]),
});

export const ContentSourceSchema = z.strictObject({
  schemaVersion: z.union([z.literal(CONTENT_SCHEMA_VERSION),z.literal(2)]), purpose: z.enum(['structural-fixture','production']),
  characters: z.array(CharacterSchema).min(1).max(64), abilities: z.array(AbilitySchema).min(1).max(256),
  statuses: z.array(StatusSchema).max(64), passives: z.array(PassiveSchema).max(64),
  profiles: z.array(ProfileSchema).min(1).max(64), pacingProfiles: z.array(PacingProfileSchema).max(16), arenas: z.array(ArenaSchema).min(1).max(16),
});

export type ContentSource = z.infer<typeof ContentSourceSchema>;
export type CharacterDefinition = ContentSource['characters'][number];
export type AbilityDefinition = ContentSource['abilities'][number];
export type AIProfile = ContentSource['profiles'][number];
export type Effect = AbilityDefinition['timeline'][number]['effects'][number];
export type Condition = AbilityDefinition['conditions'][number];
export const RubberWallParamsSchema = z.strictObject({
  minIncomingSpeed: finite.min(250).max(1800), internalCooldownTicks: tick.min(6),
  maxStacks: z.literal(3), durationTicks: duration.max(120), growthCoefficient: finite.min(0).max(0.1),
});
