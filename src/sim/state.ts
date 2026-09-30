import type { Entity, MatchConfig, WorldState } from '../contracts/state.js';
import { MatchConfigSchema, WorldStateSchema } from '../contracts/world-schema.js';
import { RULES_VERSION, TICK_RATE, WORLD_SCHEMA_VERSION } from '../contracts/versions.js';
import { deepFreeze } from '../math/canonical.js';
import { hashCanonical } from '../math/hash.js';
import { deriveSeed, Xoshiro128ss } from '../math/random.js';
import type { ContentBundle } from '../contracts/content.js';

export const RULES_DESCRIPTOR = deepFreeze({
  id: 'phase0-neutral-fixture', version: RULES_VERSION, tickRate: TICK_RATE,
  input: 'neutral-only', bodies: 'stationary-fixture', energyPerSecond: 1, maxEnergy: 100,
  maxTicks: 3600, timeoutDrawTolerance: 0.005,
});
export const RULES_HASH = hashCanonical(RULES_DESCRIPTOR);

export function createInitialState(configInput: MatchConfig, content: ContentBundle): WorldState {
  const config = MatchConfigSchema.parse(configInput);
  if (config.contentHash !== content.bundleHash) throw new Error('MatchConfig contentHash does not match ContentBundle');
  if (content.source.purpose !== 'structural-fixture') throw new Error('Phase 0 only runs structural-fixture content');
  const arena = content.source.arenas.find((item) => item.id === config.arenaId);
  if (!arena) throw new Error(`Unknown arenaId ${config.arenaId}`);
  if (config.participants[0].participantId === config.participants[1].participantId) throw new Error('participantId must be unique');
  const entities = config.participants.map((participant,index): Entity => {
    const character = content.source.characters.find((item) => item.id === participant.characterId);
    if (!character) throw new Error(`Unknown characterId ${participant.characterId}`);
    if (!content.source.profiles.some((item) => item.id === participant.profileId)) throw new Error(`Unknown profileId ${participant.profileId}`);
    const spawn = arena.spawnPositions[index]!;
    const radius = character.body.radius;
    return {
      id: index+1, participantId: participant.participantId, characterId: character.id,
      body: {
        position: { x: Math.max(radius,Math.min(arena.width-radius,spawn.x)), y: radius },
        velocity: { x: 0, y: 0 }, radius, mass: character.body.mass, grounded: true, facing: index === 0 ? 1 : -1,
      },
      hp: character.stats.maxHp, maxHp: character.stats.maxHp, energy: 0,
    };
  }) as [Entity,Entity];
  return deepFreeze({
    schemaVersion: WORLD_SCHEMA_VERSION, tick: 0, config, rulesHash: RULES_HASH, contentHash: content.bundleHash,
    entities, combatRngState: new Xoshiro128ss(deriveSeed(config.seed,'combat')).snapshot(), nextEventSeq: 1, result: null,
  });
}

export function validateSnapshot(input: unknown): WorldState {
  const state = WorldStateSchema.parse(input);
  if (state.rulesHash !== RULES_HASH || state.contentHash !== state.config.contentHash) throw new Error('Snapshot rules/content identity mismatch');
  if (state.tick > state.config.maxTicks || (state.result === null) !== (state.tick < state.config.maxTicks)) throw new Error('Snapshot terminal boundary mismatch');
  if (state.combatRngState.every((value) => value === 0)) throw new Error('Snapshot all-zero PRNG state');
  state.entities.forEach((entity,i) => {
    const participant = state.config.participants[i]!;
    if (entity.id !== i+1 || entity.participantId !== participant.participantId || entity.characterId !== participant.characterId || entity.hp > entity.maxHp) throw new Error('Snapshot entity identity/HP mismatch');
  });
  if (state.config.participants[0].participantId === state.config.participants[1].participantId) throw new Error('Snapshot duplicate participantId');
  if (state.result) {
    const winner = timeoutWinner(state.entities);
    if (state.result.matchId !== state.config.matchId || state.result.endedAfterTicks !== state.tick || state.result.winnerParticipantId !== winner || state.result.remainingHp.some((hp,i) => hp !== state.entities[i]!.hp)) throw new Error('Snapshot result mismatch');
  }
  if (state.nextEventSeq !== (state.result ? 2 : 1)) throw new Error('Snapshot event cursor mismatch');
  return deepFreeze(state);
}

export const worldHash = (world: WorldState): string => hashCanonical(world);

export function timeoutWinner(entities: WorldState['entities']): string | null {
  // 交叉相乘避免 99.5/100 - 1 在 0.005 边界的浮点减法误差。
  const difference = entities[0].hp*entities[1].maxHp - entities[1].hp*entities[0].maxHp;
  const tolerance = RULES_DESCRIPTOR.timeoutDrawTolerance*entities[0].maxHp*entities[1].maxHp;
  return Math.abs(difference) <= tolerance ? null : entities[difference > 0 ? 0 : 1].participantId;
}
