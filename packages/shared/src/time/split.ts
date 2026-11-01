import { addDays } from './calendar.ts';
import { startOfLocalDay } from './ranges.ts';
import { toLocalDate } from './zones.ts';

export interface DayPortion {
  /** Local calendar date ("YYYY-MM-DD") in the requested zone. */
  date: string;
  start: Date;
  end: Date;
  seconds: number;
}

/**
 * Splits [start, end) into the parts that fall on each local calendar day, e.g. an entry from
 * 22:00 to 02:00 counts 2 h on each day. Seconds are whole and always sum to the rounded total,
 * even if the instants carry milliseconds.
 */
export function splitByLocalDay(start: Date, end: Date, zone: string): DayPortion[] {
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) throw new RangeError('Invalid date');
  if (endMs < startMs) throw new RangeError('end must not be before start');

  const portions: DayPortion[] = [];
  // Seconds are derived from cumulative elapsed time so rounding never drifts across portions.
  const elapsedSeconds = (ms: number) => Math.round((ms - startMs) / 1000);
  let date = toLocalDate(start, zone);
  let cursor = startMs;

  while (cursor < endMs) {
    const nextDate = addDays(date, 1);
    const portionEnd = Math.min(endMs, startOfLocalDay(nextDate, zone).getTime());
    portions.push({
      date,
      start: new Date(cursor),
      end: new Date(portionEnd),
      seconds: elapsedSeconds(portionEnd) - elapsedSeconds(cursor),
    });
    cursor = portionEnd;
    date = nextDate;
  }
  return portions;
}

/** Sums split portions per local date, e.g. to build a day or week report for one zone. */
export function secondsPerLocalDay(
  entries: readonly { start: Date; end: Date }[],
  zone: string,
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    for (const portion of splitByLocalDay(entry.start, entry.end, zone)) {
      totals.set(portion.date, (totals.get(portion.date) ?? 0) + portion.seconds);
    }
  }
  return totals;
}
