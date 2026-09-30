import { createHash } from 'node:crypto';
import { describe,expect,test } from 'vitest';
import { canonicalSerialize } from '../../src/math/canonical.js';
import { hashCanonical,sha256 } from '../../src/math/hash.js';

describe('canonical state bytes and SHA-256',() => {
  test('nested key sorting, business array order and negative zero',() => {
    expect(canonicalSerialize({ z: -0,a: { c: 2,b: 1 },list: [2,1] })).toBe('{"a":{"b":1,"c":2},"list":[2,1],"z":0}');
    expect(hashCanonical({ b: 2,a: 1 })).toBe(hashCanonical({ a: 1,b: 2 }));
    expect(hashCanonical([1,2])).not.toBe(hashCanonical([2,1]));
  });
  test.each([NaN,Infinity,-Infinity,undefined,1n,new Date(),new Map(),new Set()])('rejects unsupported values: %s',(value) => {
    expect(() => canonicalSerialize({ bad: value })).toThrow(/\$\.bad/);
  });
  test('rejects cycles, holes and accessors',() => {
    const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
    expect(() => canonicalSerialize(cyclic)).toThrow(/cyclic/);
    expect(() => canonicalSerialize(new Array(2))).toThrow(/sparse/);
    expect(() => canonicalSerialize({ get hidden() { return 3; } })).toThrow(/accessors/);
  });
  test('standard published empty and abc test vectors',() => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
  test.each(['中文 / emoji 🎮','a'.repeat(55),'a'.repeat(56),'a'.repeat(64),'x'.repeat(10000)])('matches independent Node crypto across block/UTF-8 boundaries',(text) => {
    expect(sha256(text)).toBe(createHash('sha256').update(text,'utf8').digest('hex'));
  });
});
