import { describe, expect, it } from 'vitest';
import { secondsPerLocalDay, splitByLocalDay } from '../../src/index.ts';

const utc = (iso: string) => new Date(iso);
const H = 3600;

function summary(start: string, end: string, zone: string) {
  return splitByLocalDay(utc(start), utc(end), zone).map((p) => [p.date, p.seconds]);
}

describe('splitByLocalDay', () => {
  it('returns one portion for an entry within a day', () => {
    expect(
      splitByLocalDay(utc('2026-06-01T07:00:00Z'), utc('2026-06-01T09:30:00Z'), 'Europe/Berlin'),
    ).toEqual([
      {
        date: '2026-06-01',
        start: utc('2026-06-01T07:00:00Z'),
        end: utc('2026-06-01T09:30:00Z'),
        seconds: 2.5 * H,
      },
    ]);
  });

  it('splits 22:00–02:00 Berlin into 2 h + 2 h', () => {
    const portions = splitByLocalDay(
      utc('2026-06-01T20:00:00Z'),
      utc('2026-06-02T00:00:00Z'),
      'Europe/Berlin',
    );
    expect(portions).toEqual([
      {
        date: '2026-06-01',
        start: utc('2026-06-01T20:00:00Z'),
        end: utc('2026-06-01T22:00:00Z'),
        seconds: 2 * H,
      },
      {
        date: '2026-06-02',
        start: utc('2026-06-01T22:00:00Z'),
        end: utc('2026-06-02T00:00:00Z'),
        seconds: 2 * H,
      },
    ]);
  });

  it('splits by the user’s zone, not UTC (Asia/Yerevan 23:30–00:45)', () => {
    expect(summary('2026-06-01T19:30:00Z', '2026-06-01T20:45:00Z', 'Asia/Yerevan')).toEqual([
      ['2026-06-01', 30 * 60],
      ['2026-06-02', 45 * 60],
    ]);
    // The same entry is entirely on one day in UTC and in New York.
    expect(summary('2026-06-01T19:30:00Z', '2026-06-01T20:45:00Z', 'UTC')).toEqual([
      ['2026-06-01', 75 * 60],
    ]);
    expect(summary('2026-06-01T19:30:00Z', '2026-06-01T20:45:00Z', 'America/New_York')).toEqual([
      ['2026-06-01', 75 * 60],
    ]);
  });

  it('splits multi-day entries into full days in between', () => {
    expect(summary('2026-06-01T18:00:00Z', '2026-06-03T06:00:00Z', 'UTC')).toEqual([
      ['2026-06-01', 6 * H],
      ['2026-06-02', 24 * H],
      ['2026-06-03', 6 * H],
    ]);
  });

  it('does not create an empty portion when the entry ends exactly at midnight', () => {
    expect(summary('2026-06-01T20:00:00Z', '2026-06-01T22:00:00Z', 'Europe/Berlin')).toEqual([
      ['2026-06-01', 2 * H],
    ]);
  });

  it('starts on the next day when the entry starts exactly at midnight', () => {
    expect(summary('2026-06-01T22:00:00Z', '2026-06-01T23:00:00Z', 'Europe/Berlin')).toEqual([
      ['2026-06-02', H],
    ]);
  });

  describe('across DST changes', () => {
    it('Berlin fall-back night 22:00–04:00 local is 2 h + 5 h', () => {
      // 2026-10-24 22:00 CEST (20:00Z) → 2026-10-25 04:00 CET (03:00Z): 7 real hours.
      expect(summary('2026-10-24T20:00:00Z', '2026-10-25T03:00:00Z', 'Europe/Berlin')).toEqual([
        ['2026-10-24', 2 * H],
        ['2026-10-25', 5 * H],
      ]);
    });

    it('Berlin spring-forward night 22:00–04:00 local is 2 h + 3 h', () => {
      // 2026-03-28 22:00 CET (21:00Z) → 2026-03-29 04:00 CEST (02:00Z): 5 real hours.
      expect(summary('2026-03-28T21:00:00Z', '2026-03-29T02:00:00Z', 'Europe/Berlin')).toEqual([
        ['2026-03-28', 2 * H],
        ['2026-03-29', 3 * H],
      ]);
    });

    it('New York fall-back night 23:00–03:00 local is 1 h + 4 h', () => {
      // 2026-10-31 23:00 EDT (03:00Z) → 2026-11-01 03:00 EST (08:00Z).
      expect(summary('2026-11-01T03:00:00Z', '2026-11-01T08:00:00Z', 'America/New_York')).toEqual([
        ['2026-10-31', H],
        ['2026-11-01', 4 * H],
      ]);
    });

    it('New York spring-forward night 23:00–03:00 local is 1 h + 2 h', () => {
      // 2026-03-07 23:00 EST (04:00Z) → 2026-03-08 03:00 EDT (07:00Z).
      expect(summary('2026-03-08T04:00:00Z', '2026-03-08T07:00:00Z', 'America/New_York')).toEqual([
        ['2026-03-07', H],
        ['2026-03-08', 2 * H],
      ]);
    });
  });

  it('splits across the leap day', () => {
    expect(summary('2028-02-28T22:00:00Z', '2028-03-01T02:00:00Z', 'UTC')).toEqual([
      ['2028-02-28', 2 * H],
      ['2028-02-29', 24 * H],
      ['2028-03-01', 2 * H],
    ]);
  });

  it('keeps whole seconds that sum to the rounded total even with milliseconds', () => {
    const start = utc('2026-06-01T21:59:59.600Z');
    const end = utc('2026-06-01T22:00:01.700Z');
    const portions = splitByLocalDay(start, end, 'Europe/Berlin');
    expect(portions.map((p) => p.seconds)).toEqual([0, 2]);
    expect(portions.reduce((s, p) => s + p.seconds, 0)).toBe(
      Math.round((end.getTime() - start.getTime()) / 1000),
    );
  });

  it('always sums to the total duration', () => {
    const start = utc('2026-10-23T19:17:23Z');
    const end = utc('2026-10-27T05:41:09Z');
    const portions = splitByLocalDay(start, end, 'Europe/Berlin');
    expect(portions.reduce((s, p) => s + p.seconds, 0)).toBe(
      (end.getTime() - start.getTime()) / 1000,
    );
    expect(portions.map((p) => p.date)).toEqual([
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
    ]);
    expect(portions[2]?.seconds).toBe(25 * H);
  });

  it('returns nothing for an empty range and throws for a reversed one', () => {
    expect(
      splitByLocalDay(utc('2026-06-01T10:00:00Z'), utc('2026-06-01T10:00:00Z'), 'UTC'),
    ).toEqual([]);
    expect(() =>
      splitByLocalDay(utc('2026-06-01T10:00:00Z'), utc('2026-06-01T09:00:00Z'), 'UTC'),
    ).toThrow(RangeError);
    expect(() => splitByLocalDay(new Date(Number.NaN), utc('2026-06-01T09:00:00Z'), 'UTC')).toThrow(
      RangeError,
    );
  });
});

describe('secondsPerLocalDay', () => {
  it('totals entries per local day, attributing midnight-crossing parts correctly', () => {
    const totals = secondsPerLocalDay(
      [
        { start: utc('2026-06-01T07:00:00Z'), end: utc('2026-06-01T11:00:00Z') }, // 09–13 Berlin
        { start: utc('2026-06-01T20:00:00Z'), end: utc('2026-06-02T00:30:00Z') }, // 22:00–02:30
        { start: utc('2026-06-02T07:00:00Z'), end: utc('2026-06-02T08:00:00Z') },
      ],
      'Europe/Berlin',
    );
    expect(Object.fromEntries(totals)).toEqual({ '2026-06-01': 6 * H, '2026-06-02': 3.5 * H });
  });
});
