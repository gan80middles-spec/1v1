import { expect,test } from 'vitest';
import { FIXED_DELTA_SECONDS,secondsToTicks,ticksToSeconds } from '../../src/math/time.js';

test('60 Hz conversion rounds at compilation and preserves tiny positive durations',() => {
  expect(FIXED_DELTA_SECONDS).toBe(1/60);
  expect(secondsToTicks(0)).toBe(0);
  expect(secondsToTicks(0.001)).toBe(1);
  expect(secondsToTicks(1.5)).toBe(90);
  expect(ticksToSeconds(600)).toBe(10);
  expect(() => secondsToTicks(NaN)).toThrow();
  expect(() => secondsToTicks(-1)).toThrow();
  expect(() => ticksToSeconds(0.5)).toThrow();
});
