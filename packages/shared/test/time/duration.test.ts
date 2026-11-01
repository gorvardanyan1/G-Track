import { describe, expect, it } from 'vitest';
import {
  formatDecimalHours,
  formatDuration,
  formatDurationHm,
  toDecimalHours,
} from '../../src/index.ts';

describe('formatDuration (HH:MM:SS)', () => {
  it.each([
    [0, '00:00:00'],
    [59, '00:00:59'],
    [60, '00:01:00'],
    [3599, '00:59:59'],
    [3600, '01:00:00'],
    [5415, '01:30:15'],
    [86_399, '23:59:59'],
    [86_400, '24:00:00'],
    [97_389, '27:03:09'],
    [360_000, '100:00:00'],
  ])('%i s → %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it('truncates fractional seconds (a live timer never shows a second early)', () => {
    expect(formatDuration(59.999)).toBe('00:00:59');
  });

  it('prefixes negative durations and never shows "-00:00:00"', () => {
    expect(formatDuration(-61)).toBe('-00:01:01');
    expect(formatDuration(-0.4)).toBe('00:00:00');
  });

  it('rejects non-finite values', () => {
    expect(() => formatDuration(Number.NaN)).toThrow(RangeError);
    expect(() => formatDuration(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('formatDurationHm', () => {
  it.each([
    [0, '0:00'],
    [59, '0:00'],
    [5415, '1:30'],
    [97_389, '27:03'],
    [-3600, '-1:00'],
  ])('%i s → %s', (seconds, expected) => {
    expect(formatDurationHm(seconds)).toBe(expected);
  });
});

describe('formatDecimalHours', () => {
  it.each([
    [0, '0.00'],
    [900, '0.25'],
    [5400, '1.50'],
    [3600, '1.00'],
    [86_400, '24.00'],
    [1, '0.00'],
    [18, '0.01'], // exactly 0.005 h rounds up
    [17, '0.00'],
    [3618, '1.01'], // exactly 1.005 h, which toFixed() would get wrong
    [-5400, '-1.50'],
  ])('%i s → %s', (seconds, expected) => {
    expect(formatDecimalHours(seconds)).toBe(expected);
  });

  it('supports other precisions', () => {
    expect(formatDecimalHours(5415, 0)).toBe('2');
    expect(formatDecimalHours(5415, 1)).toBe('1.5');
    expect(formatDecimalHours(5415, 3)).toBe('1.504');
    expect(() => formatDecimalHours(5415, -1)).toThrow(RangeError);
    expect(() => formatDecimalHours(5415, 1.5)).toThrow(RangeError);
  });

  it('toDecimalHours returns a number', () => {
    expect(toDecimalHours(5400)).toBe(1.5);
    expect(toDecimalHours(3618)).toBe(1.01);
  });
});
