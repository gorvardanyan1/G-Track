import { describe, expect, it } from 'vitest';
import { addDays, secondsPerLocalDay, splitByLocalDay, toLocalDate } from '../../src/index.ts';
import { createRandom, TRICKY_ZONES } from './random.ts';

const YEAR_START = Date.parse('2026-01-01T00:00:00Z');
const YEAR_MS = 365 * 86_400_000;

describe.each(TRICKY_ZONES)('splitByLocalDay in %s (properties)', (zone) => {
  const random = createRandom();
  const cases = Array.from({ length: 250 }, () => {
    const start = YEAR_START + Math.floor(random.next() * YEAR_MS);
    // Mostly short entries, some multi-day ones; a few carry milliseconds.
    const length = random.bool(0.8) ? random.int(0, 14 * 3600) : random.int(0, 80 * 3600);
    const ms = random.bool(0.2) ? random.int(0, 999) : 0;
    return { start: new Date(start + ms), end: new Date(start + length * 1000 + ms * 2) };
  });

  it('portions are contiguous, in date order, each inside its own local day', () => {
    for (const { start, end } of cases) {
      const parts = splitByLocalDay(start, end, zone);
      if (end.getTime() === start.getTime()) {
        expect(parts).toEqual([]);
        continue;
      }
      expect(parts[0]?.start.getTime()).toBe(start.getTime());
      expect(parts.at(-1)?.end.getTime()).toBe(end.getTime());
      parts.forEach((part, i) => {
        expect(part.end.getTime()).toBeGreaterThan(part.start.getTime());
        expect(toLocalDate(part.start, zone)).toBe(part.date);
        // The last millisecond of the portion is still on the same local date.
        expect(toLocalDate(new Date(part.end.getTime() - 1), zone)).toBe(part.date);
        // No portion is longer than the longest possible local day (25 h).
        expect(part.end.getTime() - part.start.getTime()).toBeLessThanOrEqual(25 * 3_600_000);
        if (i > 0) {
          expect(part.start.getTime()).toBe(parts[i - 1]!.end.getTime());
          expect(part.date).toBe(addDays(parts[i - 1]!.date, 1));
        }
      });
    }
  });

  it('whole seconds always add up to the entry’s rounded duration (no drift)', () => {
    for (const { start, end } of cases) {
      const parts = splitByLocalDay(start, end, zone);
      const total = parts.reduce((sum, p) => sum + p.seconds, 0);
      expect(total).toBe(Math.round((end.getTime() - start.getTime()) / 1000));
      for (const p of parts) expect(Number.isInteger(p.seconds) && p.seconds >= 0).toBe(true);
    }
  });

  it('per-day totals over many entries equal the sum of all entries', () => {
    const totals = secondsPerLocalDay(cases, zone);
    const fromDays = [...totals.values()].reduce((a, b) => a + b, 0);
    const fromEntries = cases.reduce(
      (sum, c) => sum + Math.round((c.end.getTime() - c.start.getTime()) / 1000),
      0,
    );
    expect(fromDays).toBe(fromEntries);
  });
});
