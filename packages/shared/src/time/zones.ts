import { DateTime } from 'luxon';

// Etc/GMT+4 and friends are fixed offsets in disguise; profiles must use real IANA zones.
const FIXED_OFFSET_ZONE = /^Etc\/(GMT|UTC)[+-]\d+$/;
const IANA_ZONE_SHAPE = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)+$/;

/** True for IANA region zones ("Asia/Yerevan") and "UTC"; false for offsets like "+04:00". */
export function isValidTimeZone(zone: string): boolean {
  if (zone !== 'UTC' && (!IANA_ZONE_SHAPE.test(zone) || FIXED_OFFSET_ZONE.test(zone))) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

function assertZone(zone: string): void {
  if (!isValidTimeZone(zone)) throw new RangeError(`Invalid IANA time zone: ${zone}`);
}

/** The calendar date ("YYYY-MM-DD") an instant falls on in the given zone. */
export function toLocalDate(instant: Date, zone: string): string {
  assertZone(zone);
  return DateTime.fromJSDate(instant, { zone }).toISODate() as string;
}

/** "Today" for a user: the local calendar date of `now` in their zone. */
export function todayInZone(zone: string, now: Date = new Date()): string {
  return toLocalDate(now, zone);
}

/** Wall-clock date ("YYYY-MM-DD") and time ("HH:mm:ss") of an instant in a zone. */
export function toLocalDateTime(instant: Date, zone: string): { date: string; time: string } {
  assertZone(zone);
  const local = DateTime.fromJSDate(instant, { zone });
  return { date: local.toISODate() as string, time: local.toFormat('HH:mm:ss') };
}
