import { describe, expect, it } from 'vitest';
import { roundDuration, sumRounded } from '../../src/index.ts';

const m = (minutes: number, seconds = 0) => minutes * 60 + seconds;

describe('roundDuration', () => {
  it('returns the input when rounding is disabled', () => {
    expect(roundDuration(m(7, 31), { minutes: 0, mode: 'NEAREST' })).toBe(m(7, 31));
  });

  it('leaves exact multiples alone in every mode', () => {
    for (const mode of ['NEAREST', 'UP', 'DOWN'] as const) {
      expect(roundDuration(m(30), { minutes: 15, mode })).toBe(m(30));
      expect(roundDuration(0, { minutes: 15, mode })).toBe(0);
    }
  });

  it.each([
    [m(7, 29), 0],
    [m(7, 30), m(15)], // exact half rounds up
    [m(22, 29), m(15)],
    [m(22, 30), m(30)],
    [m(52, 31), m(60)],
  ])('NEAREST 15 min: %i s → %i s', (input, expected) => {
    expect(roundDuration(input, { minutes: 15, mode: 'NEAREST' })).toBe(expected);
  });

  it('UP rounds any remainder up', () => {
    expect(roundDuration(1, { minutes: 15, mode: 'UP' })).toBe(m(15));
    expect(roundDuration(m(15, 1), { minutes: 15, mode: 'UP' })).toBe(m(30));
  });

  it('DOWN drops the remainder', () => {
    expect(roundDuration(m(14, 59), { minutes: 15, mode: 'DOWN' })).toBe(0);
    expect(roundDuration(m(89, 59), { minutes: 30, mode: 'DOWN' })).toBe(m(60));
  });

  it('supports 1, 6 and 60 minute steps', () => {
    expect(roundDuration(m(1, 30), { minutes: 1, mode: 'NEAREST' })).toBe(m(2));
    expect(roundDuration(m(9), { minutes: 6, mode: 'NEAREST' })).toBe(m(12));
    expect(roundDuration(m(89), { minutes: 60, mode: 'NEAREST' })).toBe(m(60));
    expect(roundDuration(m(90), { minutes: 60, mode: 'NEAREST' })).toBe(m(120));
  });

  it('rejects invalid input', () => {
    expect(() => roundDuration(-1, { minutes: 15, mode: 'UP' })).toThrow(RangeError);
    expect(() => roundDuration(1.5, { minutes: 15, mode: 'UP' })).toThrow(RangeError);
    expect(() => roundDuration(60, { minutes: -15, mode: 'UP' })).toThrow(RangeError);
    expect(() => roundDuration(60, { minutes: 7.5, mode: 'UP' })).toThrow(RangeError);
  });
});

describe('sumRounded', () => {
  it('rounds each entry before summing, which can differ from rounding the total', () => {
    const entries = [m(7, 30), m(7, 30)];
    const rule = { minutes: 15, mode: 'NEAREST' } as const;
    expect(sumRounded(entries, rule)).toBe(m(30));
    expect(roundDuration(m(15), rule)).toBe(m(15));
  });

  it('is zero for no entries', () => {
    expect(sumRounded([], { minutes: 15, mode: 'UP' })).toBe(0);
  });
});
