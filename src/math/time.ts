import { TICK_RATE } from '../contracts/versions.js';

export const FIXED_DELTA_SECONDS = 1 / TICK_RATE;
export function secondsToTicks(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0 || seconds > 60) throw new Error('duration seconds must be finite in [0,60]');
  return seconds === 0 ? 0 : Math.max(1,Math.round(seconds*TICK_RATE));
}
export function ticksToSeconds(tick: number): number {
  if (!Number.isSafeInteger(tick) || tick < 0) throw new Error('tick must be a nonnegative safe integer');
  return tick/TICK_RATE;
}
