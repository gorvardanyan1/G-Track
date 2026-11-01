import { DateTime } from 'luxon';
import { describe, expect, it } from 'vitest';
import { addDays, localDateTimeToUtc, toLocalDateTime } from '../../src/index.ts';
import { createRandom, TRICKY_ZONES } from './random.ts';

const pad = (n: number) => String(n).padStart(2, '0');
const offsetAt = (date: string, hour: number, zone: string) =>
  DateTime.fromISO(`${date}T${pad(hour)}:00`, { zone }).offset;

/** Local dates in 2026 on which the zone's UTC offset changes. */
function transitionDays(zone: string): { date: string; shiftMinutes: number }[] {
  const days: { date: string; shiftMinutes: number }[] = [];
  let date = '2025-12-31';
  for (let i = 0; i < 366; i += 1) {
    const next = addDays(date, 1);
    const before = DateTime.fromISO(`${date}T12:00`, { zone }).offset;
    const after = DateTime.fromISO(`${next}T12:00`, { zone }).offset;
    if (before !== after) days.push({ date: next, shiftMinutes: after - before });
    date = next;
  }
  return days;
}
const QUARTERS = Array.from(
  { length: 96 },
  (_, i) => `${pad(Math.floor(i / 4))}:${pad((i % 4) * 15)}`,
);

describe.each(TRICKY_ZONES)('localDateTimeToUtc in %s (properties)', (zone) => {
  it('round-trips every existing wall-clock time on ordinary days', () => {
    const random = createRandom();
    for (let i = 0; i < 300; i += 1) {
      const date = addDays('2026-01-01', random.int(0, 364));
      const time = `${pad(random.int(0, 23))}:${pad(random.int(0, 59))}`;
      const result = localDateTimeToUtc(date, time, zone, { ambiguous: 'earlier' });
      if (!result.ok) continue; // a DST gap; covered below
      const back = toLocalDateTime(result.utc, zone);
      expect(`${back.date} ${back.time.slice(0, 5)}`).toBe(`${date} ${time}`);
    }
  });

  const transitions = transitionDays(zone);
  it('finds the expected number of DST changes in 2026', () => {
    const expected: Record<string, number> = {
      UTC: 0,
      'Asia/Yerevan': 0,
      'Asia/Kathmandu': 0,
      'Pacific/Apia': 0,
    };
    if (zone in expected) expect(transitions).toHaveLength(expected[zone]!);
    else expect(transitions).toHaveLength(2);
  });

  it.runIf(transitions.length > 0)(
    'on change days: gaps are refused, overlaps offer two instants, the rest round-trips',
    () => {
      for (const { date, shiftMinutes } of transitions) {
        let skipped = 0;
        let doubled = 0;
        // Check the change day and the day before (a midnight switch can sit on either).
        for (const day of [addDays(date, -1), date]) {
          for (const time of QUARTERS) {
            const result = localDateTimeToUtc(day, time, zone, { ambiguous: 'reject' });
            if (result.ok) {
              const back = toLocalDateTime(result.utc, zone);
              expect(`${back.date} ${back.time.slice(0, 5)}`).toBe(`${day} ${time}`);
            } else if (result.reason === 'NONEXISTENT') {
              skipped += 1;
            } else if (result.reason === 'AMBIGUOUS') {
              doubled += 1;
              const gap = (result.later.getTime() - result.earlier.getTime()) / 60_000;
              expect(gap).toBe(Math.abs(shiftMinutes));
              for (const instant of [result.earlier, result.later]) {
                const back = toLocalDateTime(instant, zone);
                expect(`${back.date} ${back.time.slice(0, 5)}`).toBe(`${day} ${time}`);
              }
            } else {
              throw new Error(`unexpected ${result.reason} for ${day} ${time}`);
            }
          }
        }
        // Clocks forward skip |shift| minutes; clocks back repeat them (in 15-minute steps).
        const slots = Math.abs(shiftMinutes) / 15;
        if (shiftMinutes > 0) expect({ skipped, doubled }).toEqual({ skipped: slots, doubled: 0 });
        else expect({ skipped, doubled }).toEqual({ skipped: 0, doubled: slots });
      }
    },
  );

  it('the earlier/later policies pick the matching instant', () => {
    for (const { date, shiftMinutes } of transitions.filter((t) => t.shiftMinutes < 0)) {
      for (const day of [addDays(date, -1), date]) {
        for (const time of QUARTERS) {
          const raw = localDateTimeToUtc(day, time, zone, { ambiguous: 'reject' });
          if (raw.ok || raw.reason !== 'AMBIGUOUS') continue;
          const earlier = localDateTimeToUtc(day, time, zone, { ambiguous: 'earlier' });
          const later = localDateTimeToUtc(day, time, zone, { ambiguous: 'later' });
          expect(earlier.ok && earlier.utc.getTime()).toBe(raw.earlier.getTime());
          expect(later.ok && later.utc.getTime()).toBe(raw.later.getTime());
          expect(offsetAt(day, 12, zone)).toBeTypeOf('number');
          void shiftMinutes;
        }
      }
    }
  });
});
