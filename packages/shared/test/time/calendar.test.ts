import { describe, expect, it } from 'vitest';
import {
  addDays,
  isoWeekday,
  isValidIsoDate,
  startOfMonthDate,
  startOfNextMonthDate,
  startOfWeekDate,
  type WeekStartDay,
} from '../../src/index.ts';

describe('addDays', () => {
  it('crosses month, year and leap boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2028-02-29', 1)).toBe('2028-03-01');
    expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('is unaffected by DST transition days', () => {
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30');
  });

  it('throws on invalid dates', () => {
    expect(() => addDays('2026-02-30', 1)).toThrow(RangeError);
    expect(() => addDays('2026-2-3', 1)).toThrow(RangeError);
  });
});

describe('isValidIsoDate', () => {
  it('knows leap years', () => {
    expect(isValidIsoDate('2028-02-29')).toBe(true);
    expect(isValidIsoDate('2000-02-29')).toBe(true);
    expect(isValidIsoDate('1900-02-29')).toBe(false);
    expect(isValidIsoDate('2027-02-29')).toBe(false);
  });
});

describe('isoWeekday', () => {
  it('returns 1 for Monday … 7 for Sunday', () => {
    expect(isoWeekday('2026-10-26')).toBe(1);
    expect(isoWeekday('2026-11-01')).toBe(7);
    expect(isoWeekday('2028-02-29')).toBe(2);
  });
});

describe('startOfWeekDate', () => {
  // 2026-10-29 is a Thursday.
  it.each<[WeekStartDay, string]>([
    [1, '2026-10-26'], // Monday
    [7, '2026-10-25'], // Sunday
    [6, '2026-10-24'], // Saturday
    [4, '2026-10-29'], // Thursday: the date itself
    [5, '2026-10-23'], // Friday: previous week
  ])('with week start %i the week of 2026-10-29 starts on %s', (weekStartDay, expected) => {
    expect(startOfWeekDate('2026-10-29', weekStartDay)).toBe(expected);
  });

  it('crosses year boundaries', () => {
    expect(startOfWeekDate('2027-01-01', 1)).toBe('2026-12-28');
    expect(startOfWeekDate('2027-01-03', 7)).toBe('2027-01-03');
  });

  it('handles leap day', () => {
    expect(startOfWeekDate('2028-02-29', 1)).toBe('2028-02-28');
    expect(startOfWeekDate('2028-03-04', 1)).toBe('2028-02-28');
    expect(startOfWeekDate('2028-03-05', 7)).toBe('2028-03-05');
  });

  it('rejects invalid week start days', () => {
    expect(() => startOfWeekDate('2026-10-29', 0 as WeekStartDay)).toThrow(RangeError);
    expect(() => startOfWeekDate('2026-10-29', 8 as WeekStartDay)).toThrow(RangeError);
  });
});

describe('month boundaries', () => {
  it('finds the first day of this and the next month', () => {
    expect(startOfMonthDate('2028-02-29')).toBe('2028-02-01');
    expect(startOfNextMonthDate('2028-02-29')).toBe('2028-03-01');
    expect(startOfNextMonthDate('2026-12-15')).toBe('2027-01-01');
  });
});
