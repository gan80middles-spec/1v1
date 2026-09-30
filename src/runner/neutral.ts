import { NEUTRAL_INTENT } from '../contracts/state.js';
import type { DomainEvent, MatchConfig, WorldState } from '../contracts/state.js';
import { ENGINE_BUILD, PRNG_VERSION, SEED_DERIVATION_VERSION, TICK_RATE } from '../contracts/versions.js';
import type { ContentBundle } from '../content/compile.js';
import { createInitialState, worldHash } from '../sim/state.js';
import { Simulation } from '../sim/step.js';
import { hashCanonical } from '../math/hash.js';

export function createNeutralConfig(content: ContentBundle, seed = 17, maxTicks = 600): MatchConfig {
  const character = content.source.characters[0]!;
  return {
    matchId: `phase0-seed-${seed}-ticks-${maxTicks}`, seed, rulesetId: 'phase0-neutral-fixture', rulesetVersion: 1,
    arenaId: content.source.arenas[0]!.id, contentHash: content.bundleHash, pacing: { mode: 'off',profileId: null },
    participants: [
      { participantId: 'A',characterId: character.id,profileId: character.aiProfileId },
      { participantId: 'B',characterId: character.id,profileId: character.aiProfileId },
    ], maxTicks,
  };
}

export function runNeutralMatch(content: ContentBundle, config: MatchConfig, recordStates = false) {
  const simulation = new Simulation(createInitialState(config,content));
  const states: WorldState[] = [];
  const hashes: string[] = [];
  const events: DomainEvent[] = [];
  const inputs = [];
  const checkpoints: { tick: number; worldHash: string }[] = [];
  const record = (): void => {
    const state = simulation.snapshot();
    const hash = worldHash(state);
    hashes.push(hash);
    if (recordStates) states.push(state);
    if (state.tick % 60 === 0 || state.result) checkpoints.push({ tick: state.tick,worldHash: hash });
  };
  record();
  while (!simulation.snapshot().result) {
    const tick = simulation.snapshot().tick;
    const intentPair = [NEUTRAL_INTENT,NEUTRAL_INTENT] as const;
    inputs.push({ tick,intents: intentPair });
    events.push(...simulation.step(intentPair).events);
    record();
  }
  const finalState = simulation.snapshot();
  return {
    reportSchemaVersion: 1, engineBuild: ENGINE_BUILD, fixture: 'neutral-no-combat', tickRate: TICK_RATE,
    prngVersion: PRNG_VERSION, seedDerivationVersion: SEED_DERIVATION_VERSION,
    config, contentHash: content.bundleHash, rulesHash: finalState.rulesHash,
    executedTicks: finalState.tick, stateCount: hashes.length, checkpoints,
    stateSequenceHash: hashCanonical(hashes), inputSequenceHash: hashCanonical(inputs), eventSequenceHash: hashCanonical(events),
    finalWorldHash: worldHash(finalState), result: finalState.result, finalState, events,
    ...(recordStates ? { states,inputs,hashes } : {}),
  };
}
