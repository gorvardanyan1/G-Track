import { describe, expect, it } from 'vitest';
import { LocalTimeError, localDateTimeToUtc, localDateTimeToUtcOrThrow } from '../../src/index.ts';

const utc = (iso: string) => new Date(iso);
const ok = (iso: string) => ({ ok: true, utc: utc(iso) });

describe('localDateTimeToUtc', () => {
  describe('Asia/Yerevan (UTC+4, no DST since 2012)', () => {
    it('converts regular times', () => {
      expect(localDateTimeToUtc('2026-06-01', '09:00', 'Asia/Yerevan')).toEqual(
        ok('2026-06-01T05:00:00Z'),
      );
      expect(localDateTimeToUtc('2026-12-01', '09:00', 'Asia/Yerevan')).toEqual(
        ok('2026-12-01T05:00:00Z'),
      );
    });

    it('maps local midnight to the previous UTC day', () => {
      expect(localDateTimeToUtc('2026-01-01', '00:00', 'Asia/Yerevan')).toEqual(
        ok('2025-12-31T20:00:00Z'),
      );
    });

    it('still knows the historical 2011 DST gap (no hard-coded offsets)', () => {
      expect(localDateTimeToUtc('2011-03-27', '02:30', 'Asia/Yerevan')).toEqual({
        ok: false,
        reason: 'NONEXISTENT',
      });
    });
  });

  describe('Europe/Berlin', () => {
    it('applies summer (+2) vs winter (+1) offsets', () => {
      expect(localDateTimeToUtc('2026-07-01', '12:00', 'Europe/Berlin')).toEqual(
        ok('2026-07-01T10:00:00Z'),
      );
      expect(localDateTimeToUtc('2026-01-15', '12:00', 'Europe/Berlin')).toEqual(
        ok('2026-01-15T11:00:00Z'),
      );
    });

    describe('spring forward 2026-03-29 (02:00 → 03:00)', () => {
      it.each(['02:00', '02:30', '02:59:59'])('reports %s as NONEXISTENT', (time) => {
        expect(localDateTimeToUtc('2026-03-29', time, 'Europe/Berlin')).toEqual({
          ok: false,
          reason: 'NONEXISTENT',
        });
      });

      it('accepts the times right around the gap', () => {
        expect(localDateTimeToUtc('2026-03-29', '01:59:59', 'Europe/Berlin')).toEqual(
          ok('2026-03-29T00:59:59Z'),
        );
        expect(localDateTimeToUtc('2026-03-29', '03:00', 'Europe/Berlin')).toEqual(
          ok('2026-03-29T01:00:00Z'),
        );
      });
    });

    describe('fall back 2026-10-25 (03:00 → 02:00)', () => {
      it('reports 02:30 as AMBIGUOUS with both instants', () => {
        expect(localDateTimeToUtc('2026-10-25', '02:30', 'Europe/Berlin')).toEqual({
          ok: false,
          reason: 'AMBIGUOUS',
          earlier: utc('2026-10-25T00:30:00Z'),
          later: utc('2026-10-25T01:30:00Z'),
        });
      });

      it('treats 02:00 as the start of the repeated hour', () => {
        const result = localDateTimeToUtc('2026-10-25', '02:00', 'Europe/Berlin');
        expect(result).toMatchObject({ ok: false, reason: 'AMBIGUOUS' });
      });

      it('resolves by policy', () => {
        expect(
          localDateTimeToUtc('2026-10-25', '02:30', 'Europe/Berlin', { ambiguous: 'earlier' }),
        ).toEqual(ok('2026-10-25T00:30:00Z'));
        expect(
          localDateTimeToUtc('2026-10-25', '02:30', 'Europe/Berlin', { ambiguous: 'later' }),
        ).toEqual(ok('2026-10-25T01:30:00Z'));
      });

      it('treats times outside the repeated hour as unambiguous', () => {
        expect(localDateTimeToUtc('2026-10-25', '01:59', 'Europe/Berlin')).toEqual(
          ok('2026-10-24T23:59:00Z'),
        );
        expect(localDateTimeToUtc('2026-10-25', '03:00', 'Europe/Berlin')).toEqual(
          ok('2026-10-25T02:00:00Z'),
        );
      });
    });
  });

  describe('America/New_York', () => {
    it('reports spring-forward 2026-03-08 02:30 as NONEXISTENT', () => {
      expect(localDateTimeToUtc('2026-03-08', '02:30', 'America/New_York')).toEqual({
        ok: false,
        reason: 'NONEXISTENT',
      });
      expect(localDateTimeToUtc('2026-03-08', '03:00', 'America/New_York')).toEqual(
        ok('2026-03-08T07:00:00Z'),
      );
    });

    it('reports fall-back 2026-11-01 01:30 as AMBIGUOUS and resolves by policy', () => {
      expect(localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York')).toEqual({
        ok: false,
        reason: 'AMBIGUOUS',
        earlier: utc('2026-11-01T05:30:00Z'),
        later: utc('2026-11-01T06:30:00Z'),
      });
      expect(
        localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York', { ambiguous: 'later' }),
      ).toEqual(ok('2026-11-01T06:30:00Z'));
    });
  });

  it('keeps seconds', () => {
    expect(localDateTimeToUtc('2026-07-01', '12:34:56', 'UTC')).toEqual(ok('2026-07-01T12:34:56Z'));
  });

  it('accepts a leap day and rejects a non-existent one', () => {
    expect(localDateTimeToUtc('2028-02-29', '10:00', 'Europe/Berlin')).toEqual(
      ok('2028-02-29T09:00:00Z'),
    );
    expect(localDateTimeToUtc('2027-02-29', '10:00', 'UTC')).toEqual({
      ok: false,
      reason: 'INVALID',
    });
  });

  it.each([
    ['2026-13-01', '10:00', 'UTC'],
    ['2026-06-01', '24:00', 'UTC'],
    ['2026-06-01', '9:00', 'UTC'],
    ['2026-06-01', '10:60', 'UTC'],
    ['2026-06-01', '10:00', '+04:00'],
    ['2026-06-01', '10:00', 'Etc/GMT-4'],
    ['01/06/2026', '10:00', 'UTC'],
  ])('rejects malformed input %s %s %s', (date, time, zone) => {
    expect(localDateTimeToUtc(date, time, zone)).toEqual({ ok: false, reason: 'INVALID' });
  });
});

describe('localDateTimeToUtcOrThrow', () => {
  it('returns the instant when valid', () => {
    expect(localDateTimeToUtcOrThrow('2026-06-01', '09:00', 'Asia/Yerevan')).toEqual(
      utc('2026-06-01T05:00:00Z'),
    );
  });

  it('throws a LocalTimeError with a clear message for a DST gap', () => {
    expect(() => localDateTimeToUtcOrThrow('2026-03-29', '02:30', 'Europe/Berlin')).toThrow(
      /does not exist in Europe\/Berlin/,
    );
    try {
      localDateTimeToUtcOrThrow('2026-03-29', '02:30', 'Europe/Berlin');
    } catch (err) {
      expect(err).toBeInstanceOf(LocalTimeError);
      expect((err as LocalTimeError).reason).toBe('NONEXISTENT');
    }
  });

  it('throws a LocalTimeError carrying both candidates for an ambiguous time', () => {
    try {
      localDateTimeToUtcOrThrow('2026-11-01', '01:30', 'America/New_York');
      expect.unreachable();
    } catch (err) {
      const error = err as LocalTimeError;
      expect(error.reason).toBe('AMBIGUOUS');
      expect(error.message).toMatch(/happens twice/);
      expect(error.earlier).toEqual(utc('2026-11-01T05:30:00Z'));
      expect(error.later).toEqual(utc('2026-11-01T06:30:00Z'));
    }
  });

  it('honours the ambiguity policy', () => {
    expect(
      localDateTimeToUtcOrThrow('2026-11-01', '01:30', 'America/New_York', {
        ambiguous: 'earlier',
      }),
    ).toEqual(utc('2026-11-01T05:30:00Z'));
  });
});
