import { DateTime } from 'luxon';
import {
  addDays,
  isValidIsoDate,
  startOfMonthDate,
  startOfNextMonthDate,
  startOfWeekDate,
  type WeekStartDay,
} from './calendar.ts';
import { isValidTimeZone } from './zones.ts';

/** Half-open UTC interval [start, end). */
export interface TimeRange {
  start: Date;
  end: Date;
}

/** A range of whole local calendar days; `lastDate` is inclusive. */
export interface DateRange extends TimeRange {
  firstDate: string;
  lastDate: string;
}

/**
 * The first instant of a local calendar day. Usually local midnight, but where midnight is
 * skipped by DST (e.g. America/Havana) it is the first wall-clock time that exists, and where
 * midnight happens twice it is the earlier one.
 */
export function startOfLocalDay(date: string, zone: string): Date {
  if (!isValidIsoDate(date)) throw new RangeError(`Invalid calendar date: ${date}`);
  if (!isValidTimeZone(zone)) throw new RangeError(`Invalid IANA time zone: ${zone}`);
  const midnight = DateTime.fromISO(`${date}T00:00:00`, { zone });
  const candidates = midnight.getPossibleOffsets().map((dt) => dt.toMillis());
  return new Date(Math.min(midnight.toMillis(), ...candidates));
}

function localDateRange(firstDate: string, nextFirstDate: string, zone: string): DateRange {
  return {
    start: startOfLocalDay(firstDate, zone),
    end: startOfLocalDay(nextFirstDate, zone),
    firstDate,
    lastDate: addDays(nextFirstDate, -1),
  };
}

/** One local day. Not always 24 h: 23 h or 25 h on DST change days. */
export function dayRange(date: string, zone: string): DateRange {
  return localDateRange(date, addDays(date, 1), zone);
}

/** The week containing `date`, starting on `weekStartDay` (1 = Monday … 7 = Sunday). */
export function weekRange(date: string, zone: string, weekStartDay: WeekStartDay): DateRange {
  const firstDate = startOfWeekDate(date, weekStartDay);
  return localDateRange(firstDate, addDays(firstDate, 7), zone);
}

/** The calendar month containing `date`. */
export function monthRange(date: string, zone: string): DateRange {
  return localDateRange(startOfMonthDate(date), startOfNextMonthDate(date), zone);
}
