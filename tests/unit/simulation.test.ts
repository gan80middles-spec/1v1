import { expect,test } from 'vitest';
import fixture from '../../content/fixtures/phase0.json' with { type: 'json' };
import { compileContent } from '../../src/content/compile.js';
import { NEUTRAL_INTENT } from '../../src/contracts/state.js';
import { canonicalSerialize } from '../../src/math/canonical.js';
import { createNeutralConfig,runNeutralMatch } from '../../src/runner/neutral.js';
import { createInitialState,worldHash } from '../../src/sim/state.js';
import { Simulation } from '../../src/sim/step.js';

const bundle = compileContent(fixture);
test('600 tick smoke checks every state/input/event and exact terminal boundary',() => {
  const config = createNeutralConfig(bundle,17,600);
  const a = runNeutralMatch(bundle,config,true);
  const b = runNeutralMatch(bundle,config,true);
  expect(canonicalSerialize(a)).toBe(canonicalSerialize(b));
  expect(a.states).toHaveLength(601); expect(a.inputs).toHaveLength(600);
  expect(a.states![599]!.result).toBeNull();
  expect(a.states![600]!.result?.endedAfterTicks).toBe(600);
  expect(a.events[0]?.tick).toBe(599);
  expect(a.finalState.entities[0].energy).toBeCloseTo(10,10);
  expect(a.finalState.entities[0].body.position).toEqual({ x: 240,y: 32 });
  expect(a.checkpoints.map((point) => point.tick)).toEqual([0,60,120,180,240,300,360,420,480,540,600]);
});
test('recording cannot change authoritative state, RNG or result',() => {
  const config = createNeutralConfig(bundle,0xffffffff,600);
  const on = runNeutralMatch(bundle,config,true); const off = runNeutralMatch(bundle,config,false);
  expect(on.finalWorldHash).toBe(off.finalWorldHash);
  expect(on.stateSequenceHash).toBe(off.stateSequenceHash);
  expect(on.eventSequenceHash).toBe(off.eventSequenceHash);
});
test('minimal world restore produces the same suffix',() => {
  const report = runNeutralMatch(bundle,createNeutralConfig(bundle,17,600),true);
  const sim = new Simulation(report.states![0]!);
  sim.restore(JSON.parse(JSON.stringify(report.states![120])) as unknown);
  for (let tick = 120;tick<600;tick++) {
    sim.step([NEUTRAL_INTENT,NEUTRAL_INTENT]);
    expect(worldHash(sim.snapshot())).toBe(report.hashes![tick+1]);
  }
  expect(() => sim.step([NEUTRAL_INTENT,NEUTRAL_INTENT])).toThrow(/terminal/);
});
test('radius-aware initialization and validated config delivery',() => {
  const changed = structuredClone(fixture); changed.characters[0]!.body.radius = 36;
  const content = compileContent(changed);
  const state = createInitialState(createNeutralConfig(content,17,1),content);
  expect(state.entities[0].body.position.y).toBe(36);
  expect(() => createInitialState({ ...state.config,contentHash: bundle.bundleHash },content)).toThrow(/contentHash/);
  expect(() => createInitialState({ ...state.config,maxTicks: 0 },content)).toThrow();
});
test('unsupported action and corrupt snapshot fail explicitly',() => {
  const sim = new Simulation(createInitialState(createNeutralConfig(bundle),bundle));
  expect(() => sim.step([{ ...NEUTRAL_INTENT,moveX: 1 },NEUTRAL_INTENT])).toThrow(/neutral inputs only/);
  const broken = structuredClone(sim.snapshot());
  expect(() => sim.restore({ ...broken,combatRngState: [0,0,0,0] })).toThrow(/all-zero/);
  expect(() => sim.restore({ ...broken,tick: 600 })).toThrow(/terminal boundary/);
  expect(() => sim.restore({ ...broken,contentHash: '0'.repeat(64) })).toThrow(/identity/);
});
test('timeout compares normalized HP and simultaneous neutral input does not favor side',() => {
  const initial = createInitialState(createNeutralConfig(bundle,17,1),bundle);
  const damaged = { ...initial,entities: [{ ...initial.entities[0],hp: 80 },initial.entities[1]] as const };
  expect(new Simulation(damaged).step([NEUTRAL_INTENT,NEUTRAL_INTENT]).state.result?.winnerParticipantId).toBe('B');
  expect(new Simulation(initial).step([NEUTRAL_INTENT,NEUTRAL_INTENT]).state.result?.winnerParticipantId).toBeNull();
  const boundary = { ...initial,entities: [{ ...initial.entities[0],hp: 99.5 },initial.entities[1]] as const };
  expect(new Simulation(boundary).step([NEUTRAL_INTENT,NEUTRAL_INTENT]).state.result?.winnerParticipantId).toBeNull();
});
