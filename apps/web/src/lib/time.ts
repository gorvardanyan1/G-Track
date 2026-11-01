import { formatDuration, formatDurationHm, isValidTimeZone, toLocalDateTime } from '@tempo/shared';

export { formatDuration, formatDurationHm };

/** The device's IANA timezone (falls back to UTC for odd environments). */
export function deviceTimeZone(): string {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone && isValidTimeZone(zone) ? zone : 'UTC';
}

/** All IANA zones the browser knows, plus UTC. */
export function timeZones(): string[] {
  const zones =
    typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
  return ['UTC', ...zones.filter((z) => z !== 'UTC' && isValidTimeZone(z))];
}

/** "UTC+04:00" for a zone at an instant. */
export function utcOffsetLabel(zone: string, at: Date = new Date()): string {
  const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
    .formatToParts(at)
    .find((p) => p.type === 'timeZoneName')?.value;
  return part === 'GMT' || !part ? 'UTC+00:00' : part.replace('GMT', 'UTC');
}

const locale = () => (typeof navigator === 'undefined' ? 'en-US' : navigator.language);

/** "09:30" in the zone. */
export function timeOf(instant: string | Date, zone: string): string {
  return toLocalDateTime(new Date(instant), zone).time.slice(0, 5);
}

/** A calendar date ("2026-10-31") formatted for display, e.g. "Sat, 31 Oct". */
export function formatDay(
  date: string,
  options: Intl.DateTimeFormatOptions = { weekday: 'short', day: 'numeric', month: 'short' },
): string {
  return new Intl.DateTimeFormat(locale(), { ...options, timeZone: 'UTC' }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

/** Decimal hours with one decimal, e.g. "7.5 h". */
export function hoursLabel(seconds: number): string {
  return `${(Math.round((seconds / 3600) * 10) / 10).toLocaleString(locale())} h`;
}

export function money(cents: number): string {
  return (cents / 100).toLocaleString(locale(), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
