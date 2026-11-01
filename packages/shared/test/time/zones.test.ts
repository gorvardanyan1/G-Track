import { describe, expect, it } from 'vitest';
import { isValidTimeZone, todayInZone, toLocalDate, toLocalDateTime } from '../../src/index.ts';

describe('isValidTimeZone', () => {
  it.each([
    'Asia/Yerevan',
    'Europe/Berlin',
    'America/New_York',
    'America/Argentina/Buenos_Aires',
    'UTC',
  ])('accepts %s', (zone) => expect(isValidTimeZone(zone)).toBe(true));

  it.each(['+04:00', 'UTC+4', 'Etc/GMT-4', 'GMT', 'Mars/Olympus_Mons', '', 'europe berlin'])(
    'rejects %j (fixed offsets and unknown zones)',
    (zone) => expect(isValidTimeZone(zone)).toBe(false),
  );
});

describe('toLocalDate / todayInZone', () => {
  const instant = new Date('2026-10-31T21:30:00Z');

  it('gives different calendar dates for the same instant in different zones', () => {
    expect(toLocalDate(instant, 'Asia/Yerevan')).toBe('2026-11-01');
    expect(toLocalDate(instant, 'Europe/Berlin')).toBe('2026-10-31');
    expect(toLocalDate(instant, 'America/New_York')).toBe('2026-10-31');
  });

  it('flips at exactly local midnight', () => {
    // Yerevan is UTC+4: 20:00Z is 00:00 the next day.
    expect(toLocalDate(new Date('2026-06-01T19:59:59Z'), 'Asia/Yerevan')).toBe('2026-06-01');
    expect(toLocalDate(new Date('2026-06-01T20:00:00Z'), 'Asia/Yerevan')).toBe('2026-06-02');
  });

  it('todayInZone uses the given clock', () => {
    expect(todayInZone('Asia/Yerevan', instant)).toBe('2026-11-01');
    expect(todayInZone('America/New_York', instant)).toBe('2026-10-31');
  });

  it('throws on invalid zones', () => {
    expect(() => toLocalDate(instant, 'Nope/Nowhere')).toThrow(RangeError);
  });
});

describe('toLocalDateTime', () => {
  it('shows the wall clock in each zone', () => {
    const instant = new Date('2026-10-25T00:30:00Z');
    expect(toLocalDateTime(instant, 'Europe/Berlin')).toEqual({
      date: '2026-10-25',
      time: '02:30:00',
    });
    expect(toLocalDateTime(new Date('2026-10-25T01:30:00Z'), 'Europe/Berlin')).toEqual({
      date: '2026-10-25',
      time: '02:30:00',
    });
    expect(toLocalDateTime(instant, 'America/New_York')).toEqual({
      date: '2026-10-24',
      time: '20:30:00',
    });
    expect(toLocalDateTime(instant, 'Asia/Yerevan')).toEqual({
      date: '2026-10-25',
      time: '04:30:00',
    });
  });
});
