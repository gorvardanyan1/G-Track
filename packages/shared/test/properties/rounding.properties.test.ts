import { describe, expect, it } from 'vitest';
import { roundDuration, sumRounded, type RoundingMode } from '../../src/index.ts';
import { createRandom } from './random.ts';

const STEPS = [1, 5, 6, 10, 15, 30, 60];
const MODES: RoundingMode[] = ['NEAREST', 'UP', 'DOWN'];

describe('roundDuration (properties)', () => {
  const random = createRandom();
  const samples = Array.from({ length: 2000 }, () =>
    random.bool(0.1) ? random.int(0, 120) : random.int(0, 30 * 3600),
  );

  it.each(MODES)('%s: a multiple of the step, within one step, idempotent', (mode) => {
    for (const minutes of STEPS) {
      const step = minutes * 60;
      for (const seconds of samples) {
        const r = roundDuration(seconds, { minutes, mode });
        expect(r % step).toBe(0);
        expect(Math.abs(r - seconds)).toBeLessThan(step);
        expect(roundDuration(r, { minutes, mode })).toBe(r);
        if (mode === 'UP') expect(r).toBeGreaterThanOrEqual(seconds);
        if (mode === 'DOWN') expect(r).toBeLessThanOrEqual(seconds);
        if (mode === 'NEAREST') expect(Math.abs(r - seconds)).toBeLessThanOrEqual(step / 2);
      }
    }
  });

  it.each(MODES)('%s: never decreases when the duration grows (monotonic)', (mode) => {
    const sorted = [...samples].sort((a, b) => a - b);
    for (const minutes of STEPS) {
      let previous = -1;
      for (const seconds of sorted) {
        const r = roundDuration(seconds, { minutes, mode });
        expect(r).toBeGreaterThanOrEqual(previous);
        previous = r;
      }
    }
  });

  it('DOWN ≤ NEAREST ≤ UP for every duration', () => {
    for (const minutes of STEPS) {
      for (const seconds of samples) {
        const down = roundDuration(seconds, { minutes, mode: 'DOWN' });
        const nearest = roundDuration(seconds, { minutes, mode: 'NEAREST' });
        const up = roundDuration(seconds, { minutes, mode: 'UP' });
        expect(down).toBeLessThanOrEqual(nearest);
        expect(nearest).toBeLessThanOrEqual(up);
      }
    }
  });

  it('a 0-minute step changes nothing; sums round each entry first', () => {
    for (const seconds of samples)
      expect(roundDuration(seconds, { minutes: 0, mode: 'UP' })).toBe(seconds);
    const list = samples.slice(0, 50);
    const rule = { minutes: 15, mode: 'UP' as const };
    expect(sumRounded(list, rule)).toBe(list.reduce((t, s) => t + roundDuration(s, rule), 0));
  });

  it('rejects negative or fractional input', () => {
    expect(() => roundDuration(-1, { minutes: 15, mode: 'UP' })).toThrow(RangeError);
    expect(() => roundDuration(1.5, { minutes: 15, mode: 'UP' })).toThrow(RangeError);
    expect(() => roundDuration(60, { minutes: 1.5, mode: 'UP' })).toThrow(RangeError);
  });
});
