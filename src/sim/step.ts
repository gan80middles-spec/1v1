import type { ActionIntent, DomainEvent, MatchResult, StepResult, WorldState } from '../contracts/state.js';
import { deepFreeze } from '../math/canonical.js';
import { hashCanonical } from '../math/hash.js';
import { FIXED_DELTA_SECONDS } from '../math/time.js';
import { timeoutWinner, validateSnapshot } from './state.js';

export class Simulation {
  private state: WorldState;
  constructor(initial: WorldState) { this.state = validateSnapshot(initial); }
  snapshot(): WorldState { return this.state; }
  restore(snapshot: unknown): void {
    const restored = validateSnapshot(snapshot);
    if (restored.contentHash !== this.state.contentHash || restored.rulesHash !== this.state.rulesHash || hashCanonical(restored.config) !== hashCanonical(this.state.config)) throw new Error('Cannot restore an unrelated match');
    this.state = restored;
  }
  step(intents: readonly [ActionIntent,ActionIntent]): StepResult {
    if (this.state.result) throw new Error('Cannot step a terminal match');
    if (intents.length !== 2 || intents.some((intent) => intent.moveX !== 0 || intent.jumpPressed !== false || intent.cast !== null || intent.requestId !== null)) throw new Error('Phase 0 fixture supports neutral inputs only');
    const old = this.state;
    const tick = old.tick + 1;
    const entities = old.entities.map((entity) => ({ ...entity, energy: Math.min(100,entity.energy+FIXED_DELTA_SECONDS) })) as unknown as WorldState['entities'];
    let result: MatchResult | null = null;
    const events: DomainEvent[] = [];
    if (tick === old.config.maxTicks) {
      result = {
        matchId: old.config.matchId, reason: 'timeout', winnerParticipantId: timeoutWinner(entities),
        endedAfterTicks: tick, remainingHp: [entities[0].hp,entities[1].hp], diagnosticCode: null,
      };
      events.push({ seq: old.nextEventSeq, tick: old.tick, type: 'MatchEnded', payload: { result } });
    }
    this.state = deepFreeze({ ...old, tick, entities, result, nextEventSeq: old.nextEventSeq+events.length });
    return deepFreeze({ state: this.state,events });
  }
}
