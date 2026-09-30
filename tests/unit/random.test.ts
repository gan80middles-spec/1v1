import { expect,test } from 'vitest';
import vectors from '../../fixtures/random-v1.json' with { type: 'json' };
import { deriveMatchSeed,deriveParticipantSeed,deriveSeed,splitMix32,Xoshiro128ss } from '../../src/math/random.js';

test('xoshiro128** fixed-state published transition vector',() => {
  const rng = new Xoshiro128ss(0); rng.restore([1,2,3,4]);
  expect(Array.from({ length: 5 },() => rng.nextUint32())).toEqual([11520,0,5927040,70819200,2031721883]);
});
test('seed initialization, repeat and checkpoint continuation',() => {
  const a = new Xoshiro128ss(17); const b = new Xoshiro128ss(17);
  const before = a.snapshot();
  expect(Array.from({ length: 100 },() => a.nextUint32())).toEqual(Array.from({ length: 100 },() => b.nextUint32()));
  a.restore(before);
  const expected = Array.from({ length: 100 },() => a.nextUint32());
  b.restore(before);
  expect(Array.from({ length: 100 },() => b.nextUint32())).toEqual(expected);
  expect(() => b.restore([0,0,0,0])).toThrow(/all-zero/);
});
test('versioned seed initialization and derivation golden vectors',() => {
  const init = splitMix32(0);
  expect(Array.from({ length: 4 },() => init())).toEqual(vectors.splitMixSeed0);
  const rng = new Xoshiro128ss(17);
  expect(rng.snapshot()).toEqual(vectors.seed17Initial);
  expect(Array.from({ length: 8 },() => rng.nextUint32())).toEqual(vectors.seed17Output);
  expect(deriveSeed(17,'combat')).toBe(vectors.derived17combat);
  expect(deriveMatchSeed(1000,'standard-vs-rubber',17)).toBe(vectors.derived1000match17);
});
test('uint32 validation and next01 half-open range',() => {
  for (const value of [-1,0x100000000,1.5,NaN]) expect(() => new Xoshiro128ss(value)).toThrow(/uint32/);
  const rng = new Xoshiro128ss(0xffffffff);
  for (let i=0;i<1000;i++) { const sample = rng.next01(); expect(sample).toBeGreaterThanOrEqual(0); expect(sample).toBeLessThan(1); }
  expect(splitMix32(0)()).not.toBe(splitMix32(1)());
});
test('derivation is typed, delimited, order-independent across task execution and follows participant',() => {
  expect(deriveSeed(1,'ab','c')).not.toBe(deriveSeed(1,'a','bc'));
  expect(deriveSeed(1,3)).not.toBe(deriveSeed(1,'3'));
  const order = [3,1,0,2];
  const seeds = order.map((index) => [index,deriveMatchSeed(1000,'standard-vs-rubber',index)] as const);
  expect(seeds.sort(([a],[b]) => a-b).map(([,seed]) => seed)).toEqual([0,1,2,3].map((index) => deriveMatchSeed(1000,'standard-vs-rubber',index)));
  const match = deriveMatchSeed(1000,'standard-vs-rubber',17);
  expect(deriveParticipantSeed(match,'utility')).toBe(deriveParticipantSeed(match,'utility'));
  expect(deriveParticipantSeed(match,'utility')).not.toBe(deriveParticipantSeed(match,'baseline'));
  expect(deriveSeed(match,'combat')).not.toBe(deriveParticipantSeed(match,'utility'));
});
