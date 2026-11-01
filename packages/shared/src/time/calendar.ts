import { DateTime } from 'luxon';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Parses a calendar date. Calendar math is zone-free, so it is done in UTC. */
function parseIsoDate(date: string): DateTime {
  const parsed = ISO_DATE.test(date) ? DateTime.fromISO(date, { zone: 'utc' }) : null;
  if (!parsed?.isValid) throw new RangeError(`Invalid calendar date: ${date}`);
  return parsed;
}

export function isValidIsoDate(date: string): boolean {
  return ISO_DATE.test(date) && DateTime.fromISO(date, { zone: 'utc' }).isValid;
}

/** Adds whole calendar days to a "YYYY-MM-DD" date (unaffected by DST). */
export function addDays(date: string, days: number): string {
  return parseIsoDate(date).plus({ days }).toISODate() as string;
}

/** ISO weekday of a calendar date: 1 = Monday … 7 = Sunday. */
export function isoWeekday(date: string): number {
  return parseIsoDate(date).weekday;
}

/** ISO weekday 1–7 (1 = Monday) that a week starts on, as configured in org settings. */
export type WeekStartDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export function isWeekStartDay(value: number): value is WeekStartDay {
  return Number.isInteger(value) && value >= 1 && value <= 7;
}

/** First calendar day of the week containing `date`. */
export function startOfWeekDate(date: string, weekStartDay: WeekStartDay): string {
  // Callers may pass unchecked numbers (e.g. from settings); widen before guarding.
  const day: number = weekStartDay;
  if (!isWeekStartDay(day)) throw new RangeError(`Invalid week start day: ${day}`);
  const daysSinceWeekStart = (isoWeekday(date) - day + 7) % 7;
  return addDays(date, -daysSinceWeekStart);
}

/** First calendar day of the month containing `date`. */
export function startOfMonthDate(date: string): string {
  return parseIsoDate(date).startOf('month').toISODate() as string;
}

/** First calendar day of the following month. */
export function startOfNextMonthDate(date: string): string {
  return parseIsoDate(date).startOf('month').plus({ months: 1 }).toISODate() as string;
}
