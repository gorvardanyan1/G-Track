import { describe, expect, it } from 'vitest';
import { dayRange, monthRange, startOfLocalDay, toLocalDate, weekRange } from '../../src/index.ts';

const utc = (iso: string) => new Date(iso);
const hours = (range: { start: Date; end: Date }) =>
  (range.end.getTime() - range.start.getTime()) / 3_600_000;

describe('startOfLocalDay', () => {
  it('is local midnight', () => {
    expect(startOfLocalDay('2026-06-01', 'Asia/Yerevan')).toEqual(utc('2026-05-31T20:00:00Z'));
    expect(startOfLocalDay('2026-06-01', 'America/New_York')).toEqual(utc('2026-06-01T04:00:00Z'));
  });

  it('is the first existing time when DST skips midnight (America/Havana 2026-03-08)', () => {
    // Cuba springs forward at 00:00 → 01:00, so the day starts at 01:00 CDT (05:00Z).
    expect(startOfLocalDay('2026-03-08', 'America/Havana')).toEqual(utc('2026-03-08T05:00:00Z'));
  });

  it('is the earlier midnight when DST repeats it (America/Havana 2026-11-01)', () => {
    // Cuba falls back at 01:00 → 00:00, so midnight happens twice; the day starts at the first.
    expect(startOfLocalDay('2026-11-01', 'America/Havana')).toEqual(utc('2026-11-01T04:00:00Z'));
  });
});

describe('dayRange', () => {
  it('is a half-open 24 h range on a normal day', () => {
    expect(dayRange('2026-06-01', 'Europe/Berlin')).toEqual({
      start: utc('2026-05-31T22:00:00Z'),
      end: utc('2026-06-01T22:00:00Z'),
      firstDate: '2026-06-01',
      lastDate: '2026-06-01',
    });
  });

  it.each([
    ['Europe/Berlin', '2026-03-29', 23],
    ['Europe/Berlin', '2026-10-25', 25],
    ['America/New_York', '2026-03-08', 23],
    ['America/New_York', '2026-11-01', 25],
    ['Asia/Yerevan', '2026-03-29', 24],
    ['Asia/Yerevan', '2026-10-25', 24],
  ])('%s %s lasts %i hours', (zone, date, expected) => {
    expect(hours(dayRange(date, zone))).toBe(expected);
  });

  it('covers a leap day', () => {
    const range = dayRange('2028-02-29', 'Asia/Yerevan');
    expect(range.start).toEqual(utc('2028-02-28T20:00:00Z'));
    expect(range.end).toEqual(utc('2028-02-29T20:00:00Z'));
  });

  it('rejects invalid input', () => {
    expect(() => dayRange('2027-02-29', 'UTC')).toThrow(RangeError);
    expect(() => dayRange('2026-06-01', '+02:00')).toThrow(RangeError);
  });
});

describe('weekRange', () => {
  it('starts on Monday in Europe/Berlin', () => {
    expect(weekRange('2026-10-29', 'Europe/Berlin', 1)).toEqual({
      start: utc('2026-10-25T23:00:00Z'),
      end: utc('2026-11-01T23:00:00Z'),
      firstDate: '2026-10-26',
      lastDate: '2026-11-01',
    });
  });

  it('starts on Sunday when configured', () => {
    const range = weekRange('2026-10-29', 'America/New_York', 7);
    expect(range.firstDate).toBe('2026-10-25');
    expect(range.lastDate).toBe('2026-10-31');
    expect(range.start).toEqual(utc('2026-10-25T04:00:00Z'));
  });

  it('starts on Saturday when configured', () => {
    const range = weekRange('2026-10-29', 'Asia/Yerevan', 6);
    expect(range.firstDate).toBe('2026-10-24');
    expect(range.lastDate).toBe('2026-10-30');
  });

  it('treats the week-start day itself as the first day', () => {
    expect(weekRange('2026-10-26', 'Europe/Berlin', 1).firstDate).toBe('2026-10-26');
    expect(weekRange('2026-11-01', 'Europe/Berlin', 1).firstDate).toBe('2026-10-26');
    expect(weekRange('2026-11-01', 'Europe/Berlin', 7).firstDate).toBe('2026-11-01');
  });

  it.each([
    ['Europe/Berlin', '2026-10-21', 1, 169], // contains the 25-hour day
    ['Europe/Berlin', '2026-03-25', 1, 167], // contains the 23-hour day
    ['America/New_York', '2026-11-03', 7, 169], // Sunday-start week beginning on fall-back day
    ['America/New_York', '2026-11-03', 1, 168], // Monday-start week after the change
    ['Asia/Yerevan', '2026-10-21', 1, 168],
  ] as const)('%s week of %s (start %i) lasts %i hours', (zone, date, start, expected) => {
    expect(hours(weekRange(date, zone, start))).toBe(expected);
  });

  it('spans the year boundary', () => {
    const range = weekRange('2027-01-01', 'Europe/Berlin', 1);
    expect(range.firstDate).toBe('2026-12-28');
    expect(range.lastDate).toBe('2027-01-03');
  });

  it('contains a leap day', () => {
    const range = weekRange('2028-02-29', 'America/New_York', 1);
    expect(range.firstDate).toBe('2028-02-28');
    expect(range.lastDate).toBe('2028-03-05');
  });

  it('puts the same instant in different weeks depending on the zone', () => {
    // Sunday 2026-11-01 21:30Z is already Monday 01:30 in Yerevan, still Sunday in New York.
    const instant = utc('2026-11-01T21:30:00Z');
    const yerevanWeek = weekRange(toLocalDate(instant, 'Asia/Yerevan'), 'Asia/Yerevan', 1);
    const newYorkWeek = weekRange(toLocalDate(instant, 'America/New_York'), 'America/New_York', 1);
    expect(yerevanWeek.firstDate).toBe('2026-11-02');
    expect(newYorkWeek.firstDate).toBe('2026-10-26');
    for (const week of [yerevanWeek, newYorkWeek]) {
      expect(instant >= week.start && instant < week.end).toBe(true);
    }
  });
});

describe('monthRange', () => {
  it('covers February in a leap year', () => {
    const range = monthRange('2028-02-10', 'Europe/Berlin');
    expect(range).toEqual({
      start: utc('2028-01-31T23:00:00Z'),
      end: utc('2028-02-29T23:00:00Z'),
      firstDate: '2028-02-01',
      lastDate: '2028-02-29',
    });
    expect(hours(range)).toBe(29 * 24);
  });

  it('includes the extra DST hour', () => {
    expect(hours(monthRange('2026-10-01', 'Europe/Berlin'))).toBe(31 * 24 + 1);
    expect(hours(monthRange('2026-03-01', 'America/New_York'))).toBe(31 * 24 - 1);
  });
});
