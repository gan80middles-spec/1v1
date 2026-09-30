import { z } from 'zod';

const uint32 = z.number().int().min(0).max(0xffffffff);
const nonnegativeInt = z.number().int().min(0);
const finite = z.number().finite();
const hash = z.string().regex(/^[0-9a-f]{64}$/);
const vec = z.strictObject({ x: finite, y: finite });
const ParticipantSchema = z.strictObject({ participantId: z.string().min(1), characterId: z.string().min(1), profileId: z.string().min(1) });
export const MatchConfigSchema = z.strictObject({
  matchId: z.string().min(1), seed: uint32, rulesetId: z.literal('phase0-neutral-fixture'), rulesetVersion: z.literal(1),
  arenaId: z.string().min(1), contentHash: hash, pacing: z.strictObject({ mode: z.literal('off'), profileId: z.null() }),
  participants: z.tuple([ParticipantSchema,ParticipantSchema]), maxTicks: z.number().int().min(1).max(3600),
});
const EntitySchema = z.strictObject({
  id: nonnegativeInt.min(1), participantId: z.string().min(1), characterId: z.string().min(1),
  body: z.strictObject({ position: vec, velocity: vec, radius: finite.min(24), mass: finite.positive(), grounded: z.boolean(), facing: z.union([z.literal(-1),z.literal(1)]) }),
  hp: finite.min(0), maxHp: finite.positive(), energy: finite.min(0).max(100),
});
export const MatchResultSchema = z.strictObject({
  matchId: z.string().min(1), reason: z.literal('timeout'), winnerParticipantId: z.string().nullable(),
  endedAfterTicks: nonnegativeInt, remainingHp: z.tuple([finite.min(0),finite.min(0)]), diagnosticCode: z.null(),
});
export const WorldStateSchema = z.strictObject({
  schemaVersion: z.literal(1), tick: nonnegativeInt, config: MatchConfigSchema, rulesHash: hash, contentHash: hash,
  entities: z.tuple([EntitySchema,EntitySchema]), combatRngState: z.tuple([uint32,uint32,uint32,uint32]),
  nextEventSeq: nonnegativeInt.min(1), result: MatchResultSchema.nullable(),
});
