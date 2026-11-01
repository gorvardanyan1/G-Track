import { describe, expect, it } from 'vitest';
import {
  FUTURE_TOLERANCE_MS,
  isLockedByAge,
  listTimeEntriesQuerySchema,
  truncateToSecond,
  validateEntryInterval,
} from '../../src/index.ts';

const utc = (iso: string) => new Date(iso);
const now = utc('2026-10-31T12:00:00Z');

describe('validateEntryInterval', () => {
  it('accepts a normal entry', () => {
    expect(
      validateEntryInterval(utc('2026-10-31T09:00:00Z'), utc('2026-10-31T10:00:00Z'), now),
    ).toEqual([]);
  });

  it('requires end after start', () => {
    expect(
      validateEntryInterval(utc('2026-10-31T09:00:00Z'), utc('2026-10-31T09:00:00Z'), now),
    ).toEqual(['END_NOT_AFTER_START']);
    expect(
      validateEntryInterval(utc('2026-10-31T09:00:00Z'), utc('2026-10-31T08:00:00Z'), now),
    ).toContain('END_NOT_AFTER_START');
  });

  it('allows exactly 24 h, not a second more', () => {
    expect(
      validateEntryInterval(utc('2026-10-30T10:00:00Z'), utc('2026-10-31T10:00:00Z'), now),
    ).toEqual([]);
    expect(
      validateEntryInterval(utc('2026-10-30T09:59:59Z'), utc('2026-10-31T10:00:00Z'), now),
    ).toEqual(['TOO_LONG']);
  });

  it('measures real elapsed time across DST (Berlin fall-back night is 25 h wall-to-wall)', () => {
    // 2026-10-25 00:00 CEST → 2026-10-26 00:00 CET is 25 real hours.
    expect(
      validateEntryInterval(utc('2026-10-24T22:00:00Z'), utc('2026-10-25T23:00:00Z'), now),
    ).toEqual(['TOO_LONG']);
  });

  it('tolerates up to one minute in the future', () => {
    const start = utc('2026-10-31T11:00:00Z');
    expect(
      validateEntryInterval(start, new Date(now.getTime() + FUTURE_TOLERANCE_MS), now),
    ).toEqual([]);
    expect(
      validateEntryInterval(start, new Date(now.getTime() + FUTURE_TOLERANCE_MS + 1000), now),
    ).toEqual(['IN_FUTURE']);
  });
});

describe('isLockedByAge', () => {
  it('locks dates older than the limit', () => {
    expect(isLockedByAge('2026-10-01', '2026-10-31', 30)).toBe(false);
    expect(isLockedByAge('2026-09-30', '2026-10-31', 30)).toBe(true);
  });

  it('crosses month and leap-year boundaries by calendar days', () => {
    expect(isLockedByAge('2028-02-29', '2028-03-01', 1)).toBe(false);
    expect(isLockedByAge('2028-02-28', '2028-03-01', 1)).toBe(true);
  });

  it('is disabled with null', () => {
    expect(isLockedByAge('2000-01-01', '2026-10-31', null)).toBe(false);
  });
});

describe('truncateToSecond', () => {
  it('drops milliseconds (never rounds up)', () => {
    expect(truncateToSecond(utc('2026-10-31T12:00:00.999Z'))).toEqual(utc('2026-10-31T12:00:00Z'));
  });
});

describe('listTimeEntriesQuerySchema', () => {
  it('accepts up to 62 days and rejects reversed or longer ranges', () => {
    expect(
      listTimeEntriesQuerySchema.safeParse({ from: '2026-09-01', to: '2026-11-01' }).success,
    ).toBe(true);
    expect(
      listTimeEntriesQuerySchema.safeParse({ from: '2026-09-01', to: '2026-11-02' }).success,
    ).toBe(false);
    expect(
      listTimeEntriesQuerySchema.safeParse({ from: '2026-10-02', to: '2026-10-01' }).success,
    ).toBe(false);
    expect(
      listTimeEntriesQuerySchema.safeParse({ from: '2026-02-30', to: '2026-03-01' }).success,
    ).toBe(false);
  });
});
