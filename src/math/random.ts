import type { RngState } from '../contracts/state.js';
import { sha256 } from './hash.js';

export function assertUint32(value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error('seed/state must be uint32');
}

// 冻结增量与 mixer；命名为 SplitMix32-v1，不依赖第三方实现变动。
export function splitMix32(seed: number): () => number {
  assertUint32(seed);
  let x = seed;
  return () => {
    x = (x + 0x9e3779b9) >>> 0;
    let z = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
    return (z ^ (z >>> 15)) >>> 0;
  };
}

export class Xoshiro128ss {
  private state: [number,number,number,number];

  constructor(seed: number) {
    const init = splitMix32(seed);
    this.state = [init(),init(),init(),init()];
    if (this.state.every((value) => value === 0)) this.state[0] = 1;
  }

  nextUint32(): number {
    let [s0,s1,s2,s3] = this.state;
    const product = Math.imul(s1,5);
    const result = Math.imul((product << 7) | (product >>> 25),9) >>> 0;
    const t = s1 << 9;
    s2 ^= s0; s3 ^= s1; s1 ^= s2; s0 ^= s3;
    s2 ^= t; s3 = (s3 << 11) | (s3 >>> 21);
    this.state = [s0>>>0,s1>>>0,s2>>>0,s3>>>0];
    return result;
  }

  next01(): number { return this.nextUint32() / 0x100000000; }
  snapshot(): RngState { return [...this.state]; }
  restore(state: RngState): void {
    if (state.length !== 4) throw new Error('PRNG state must have four words');
    state.forEach(assertUint32);
    if (state.every((value) => value === 0)) throw new Error('all-zero PRNG state is forbidden');
    this.state = [...state];
  }
}

// 每个组件带类型标签/字节长度；uint32 为大端，字符串为 UTF-8。
export function deriveSeed(root: number, ...parts: readonly (number | string)[]): number {
  assertUint32(root);
  const output: number[] = [0x01];
  const appendUint = (n: number): void => { output.push((n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255); };
  appendUint(root);
  for (const part of parts) {
    if (typeof part === 'number') {
      assertUint32(part); output.push(0); appendUint(part);
    } else {
      const bytes = new TextEncoder().encode(part);
      output.push(1); appendUint(bytes.length);
      for (const byte of bytes) output.push(byte);
    }
  }
  return Number.parseInt(sha256(Uint8Array.from(output)).slice(0,8),16) >>> 0;
}

export const deriveMatchSeed = (root: number, matchupId: string, sampleIndex: number): number => deriveSeed(root,'match',matchupId,sampleIndex);
export const deriveParticipantSeed = (matchSeed: number, participantId: string): number => deriveSeed(matchSeed,'ai',participantId);
