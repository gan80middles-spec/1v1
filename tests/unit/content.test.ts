import { describe, expect, test } from 'vitest';
import fixture from '../../content/fixtures/phase0.json' with { type: 'json' };
import { compileContent } from '../../src/content/compile.js';
import { PREDICTOR_IDS } from '../../src/contracts/versions.js';

const copy = () => structuredClone(fixture);
describe('content validation and compilation',() => {
  test('four slots, deterministic stable IDs and deeply immutable compiled content',() => {
    const input = copy();
    const compiled = compileContent(input);
    expect(compiled.source.characters[0]!.slots.ultimate).toBe('fixture-volley');
    expect(compiled.stableIds.abilities['fixture-volley']).toBe(1);
    expect(Object.isFrozen(compiled.source.characters[0]!.body)).toBe(true);
    input.characters[0]!.body.mass = 2;
    expect(compiled.source.characters[0]!.body.mass).toBe(1);
  });
  test('object key and definition order do not change content hash',() => {
    const original = copy();
    const reordered = Object.fromEntries(Object.entries(copy()).reverse());
    (reordered['abilities'] as unknown[]).reverse();
    expect(compileContent(reordered).bundleHash).toBe(compileContent(original).bundleHash);
  });
  test.each([
    ['bad reference',(input: ReturnType<typeof copy>) => { input.characters[0]!.slots.skill1 = 'missing'; }, /characters\.0\.slots\.skill1/],
    ['duplicate ID',(input: ReturnType<typeof copy>) => { input.abilities[1]!.id = input.abilities[0]!.id; }, /abilities\.1\.id/],
    ['fractional tick',(input: ReturnType<typeof copy>) => { input.abilities[0]!.startupTicks = 1.5; }, /abilities\.0\.startupTicks/],
    ['negative delay',(input: ReturnType<typeof copy>) => { input.profiles[0]!.reactionDelayTicks = -1; }, /profiles\.0\.reactionDelayTicks/],
    ['out-of-range body',(input: ReturnType<typeof copy>) => { input.characters[0]!.body.radius = 23; }, /characters\.0\.body\.radius/],
    ['NaN',(input: ReturnType<typeof copy>) => { input.characters[0]!.body.mass = NaN; }, /characters\.0\.body\.mass/],
    ['wrong ultimate cost',(input: ReturnType<typeof copy>) => { input.abilities[3]!.energyCost = 0; }, /characters\.0\.slots\.ultimate/],
    ['outside timeline',(input: ReturnType<typeof copy>) => { input.abilities[0]!.timeline[0]!.offsetTick = 26; }, /abilities\.0\.timeline\.0\.offsetTick/],
    ['short cooldown',(input: ReturnType<typeof copy>) => { input.abilities[0]!.cooldownTicks = 25; }, /abilities\.0\.cooldownTicks/],
    ['inverted distance',(input: ReturnType<typeof copy>) => { input.abilities[0]!.ai.preferredCenterDistance = [200,100]; }, /abilities\.0\.ai\.preferredCenterDistance/],
  ])('%s errors report a concrete path',(_name,mutate,error) => {
    const input = copy(); mutate(input);
    expect(() => compileContent(input)).toThrow(error);
  });
  test('unknown fields and missing fourth slot fail strict validation',() => {
    expect(() => compileContent({ ...copy(),hidden: true })).toThrow(/Unrecognized key/);
    const input = copy();
    delete (input.characters[0]!.slots as Partial<typeof input.characters[0]['slots']>).ultimate;
    expect(() => compileContent(input)).toThrow(/characters\.0\.slots\.ultimate/);
  });
  test('predictor must exist in the supplied registry',() => {
    expect(() => compileContent(copy(),{ predictors: new Set(PREDICTOR_IDS.filter((id) => id !== 'volley')) })).toThrow(/unregistered predictor volley/);
  });
  test('plugins require both registration and parameter validation',() => {
    const input = copy() as unknown as Record<string,unknown>;
    const abilities = input['abilities'] as { timeline: { effects: unknown[] }[] }[];
    abilities[0]!.timeline[0]!.effects = [{ kind: 'plugin',pluginId: 'fixture-plugin',params: { stacks: 9 } }];
    expect(() => compileContent(input)).toThrow(/unregistered plugin/);
    const registration = { version: 1,validateParams: (params: Readonly<Record<string,number|string|boolean>>) => params['stacks'] === 3 ? null : 'stacks must be 3' };
    expect(() => compileContent(input,{ plugins: { 'fixture-plugin': registration } })).toThrow(/params: stacks must be 3/);
    abilities[0]!.timeline[0]!.effects = [{ kind: 'plugin',pluginId: 'fixture-plugin',params: { stacks: 3 } }];
    expect(compileContent(input,{ plugins: { 'fixture-plugin': registration } }).pluginVersions['fixture-plugin']).toBe(1);
  });
});
