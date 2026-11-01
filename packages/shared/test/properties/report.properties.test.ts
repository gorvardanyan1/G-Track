import { describe, expect, it } from 'vitest';
import {
  addDays,
  reportPortions,
  roundDuration,
  startOfLocalDay,
  summarizeReport,
  type ReportEntryInput,
  type RoundingRule,
} from '../../src/index.ts';
import { createRandom, TRICKY_ZONES } from './random.ts';

const uuid = (n: number) => `0190e5b2-0000-7000-8000-${String(n).padStart(12, '0')}`;

function randomCase(seed: number) {
  const random = createRandom(seed);
  const zone = random.pick(TRICKY_ZONES);
  const from = addDays('2026-01-01', random.int(0, 330));
  const to = addDays(from, random.int(0, 30));
  const range = { start: startOfLocalDay(from, zone), end: startOfLocalDay(addDays(to, 1), zone) };
  const span = range.end.getTime() - range.start.getTime();
  const entries: ReportEntryInput[] = Array.from({ length: random.int(0, 60) }, (_, i) => {
    // Some entries start before the range or end after it (clipping).
    const start =
      range.start.getTime() - 2 * 86_400_000 + Math.floor(random.next() * (span + 4 * 86_400_000));
    const seconds = random.int(1, random.bool(0.85) ? 10 * 3600 : 60 * 3600);
    return {
      id: uuid(i + 1),
      userId: uuid(100 + random.int(1, 4)),
      projectId: uuid(200 + random.int(1, 3)),
      taskId: random.bool(0.4) ? null : uuid(300 + random.int(1, 5)),
      isBillable: random.bool(0.7),
      startedAt: new Date(start),
      endedAt: new Date(start + seconds * 1000),
      rateCents: random.bool(0.2) ? null : random.int(0, 25_000),
    };
  });
  const rounding: RoundingRule | null = random.bool(0.5)
    ? {
        minutes: random.pick([5, 6, 10, 15, 30, 60]),
        mode: random.pick(['NEAREST', 'UP', 'DOWN'] as const),
      }
    : null;
  return { zone, from, to, range, entries, rounding };
}

const CASES = Array.from({ length: 150 }, (_, i) => 1000 + i);

describe('reportPortions + summarizeReport (properties)', () => {
  it.each(CASES)('case %i: every breakdown adds up to the same totals', (seed) => {
    const { zone, from, to, range, entries, rounding } = randomCase(seed);
    const portions = reportPortions(entries, { range, zone, rounding });
    const summary = summarizeReport(portions, from, to);
    const { totals } = summary;

    const sum = <T extends { seconds: number; billableSeconds: number; amountCents: number }>(
      rows: T[],
    ) =>
      rows.reduce(
        (a, r) => ({
          seconds: a.seconds + r.seconds,
          billableSeconds: a.billableSeconds + r.billableSeconds,
          amountCents: a.amountCents + r.amountCents,
        }),
        { seconds: 0, billableSeconds: 0, amountCents: 0 },
      );
    const expected = {
      seconds: totals.seconds,
      billableSeconds: totals.billableSeconds,
      amountCents: totals.amountCents,
    };
    expect(sum(summary.byDay)).toEqual(expected);
    expect(sum(summary.byProject)).toEqual(expected);
    expect(sum(summary.byTask)).toEqual(expected);
    expect(sum(summary.byUser)).toEqual(expected);

    // Every date of the range is present exactly once, in order.
    const dates: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
    expect(summary.byDay.map((d) => d.date)).toEqual(dates);
    expect(totals.billableSeconds).toBeLessThanOrEqual(totals.seconds);
  });

  it.each(CASES)('case %i: each entry is clipped, rounded once and priced once', (seed) => {
    const { zone, range, entries, rounding } = randomCase(seed);
    const portions = reportPortions(entries, { range, zone, rounding });
    for (const entry of entries) {
      const own = portions.filter((p) => p.entry.id === entry.id);
      const clippedMs =
        Math.min(entry.endedAt.getTime(), range.end.getTime()) -
        Math.max(entry.startedAt.getTime(), range.start.getTime());
      if (clippedMs <= 0) {
        expect(own).toEqual([]);
        continue;
      }
      const raw = own.reduce((a, p) => a + p.rawSeconds, 0);
      expect(raw).toBe(Math.round(clippedMs / 1000));
      const rounded = rounding ? roundDuration(raw, rounding) : raw;
      expect(own.reduce((a, p) => a + p.seconds, 0)).toBe(rounded);
      const cents = own.reduce((a, p) => a + p.amountCents, 0);
      const priced = entry.isBillable && entry.rateCents !== null;
      expect(cents).toBe(priced ? Math.round((rounded * entry.rateCents!) / 3600) : 0);
      for (const p of own) {
        expect(p.seconds).toBeGreaterThanOrEqual(0);
        expect(p.billableSeconds).toBe(entry.isBillable ? p.seconds : 0);
        expect(p.start >= range.start && p.end <= range.end).toBe(true);
      }
    }
  });
});
