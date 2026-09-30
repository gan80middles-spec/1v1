export const TICK_RATE = 60 as const;
export const PHYSICS_SUBSTEPS = 4 as const;
export const CONTENT_SCHEMA_VERSION = 1 as const;
export const WORLD_SCHEMA_VERSION = 1 as const;
export const RULES_VERSION = 1 as const;
export const PRNG_VERSION = 'xoshiro128ss-splitmix32-v1' as const;
export const SEED_DERIVATION_VERSION = 'sha256-tagged-be-v1' as const;
export const ENGINE_BUILD = 'phase0-v1' as const;

export const SLOTS = ['basic', 'skill1', 'skill2', 'ultimate'] as const;
export type Slot = typeof SLOTS[number];
export const PREDICTOR_IDS = ['melee', 'projectile', 'dash-hit', 'guard', 'reflect', 'self-buff', 'volley'] as const;
export type PredictorId = typeof PREDICTOR_IDS[number];
