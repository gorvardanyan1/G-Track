import { DateTime } from 'luxon';
import { isValidIsoDate } from './calendar.ts';
import { isValidTimeZone } from './zones.ts';

const LOCAL_TIME = /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/;

export type AmbiguousTimePolicy = 'reject' | 'earlier' | 'later';

export type LocalToUtcResult =
  | { ok: true; utc: Date }
  /** Malformed date/time or zone. */
  | { ok: false; reason: 'INVALID' }
  /** Wall-clock time skipped by a DST jump (e.g. 02:30 on spring-forward day). */
  | { ok: false; reason: 'NONEXISTENT' }
  /** Wall-clock time that happens twice (fall-back day); both instants are returned. */
  | { ok: false; reason: 'AMBIGUOUS'; earlier: Date; later: Date };

/**
 * Converts a wall-clock date + time in an IANA zone to a UTC instant.
 * DST gaps and overlaps are reported explicitly instead of being silently shifted.
 */
export function localDateTimeToUtc(
  date: string,
  time: string,
  zone: string,
  options: { ambiguous?: AmbiguousTimePolicy } = {},
): LocalToUtcResult {
  if (!isValidIsoDate(date) || !LOCAL_TIME.test(time) || !isValidTimeZone(zone)) {
    return { ok: false, reason: 'INVALID' };
  }

  const local = DateTime.fromISO(`${date}T${time}`, { zone });
  if (!local.isValid) return { ok: false, reason: 'INVALID' };

  // Luxon moves non-existent times forward; if the wall clock changed, it never existed.
  const requested = DateTime.fromISO(`${date}T${time}`, { zone: 'utc' });
  if (local.toFormat('yyyy-MM-dd HH:mm:ss') !== requested.toFormat('yyyy-MM-dd HH:mm:ss')) {
    return { ok: false, reason: 'NONEXISTENT' };
  }

  const candidates = local
    .getPossibleOffsets()
    .map((dt) => dt.toJSDate())
    .sort((a, b) => a.getTime() - b.getTime());
  const [earlier, later] = candidates;
  if (earlier && later) {
    const policy = options.ambiguous ?? 'reject';
    if (policy === 'reject') return { ok: false, reason: 'AMBIGUOUS', earlier, later };
    return { ok: true, utc: policy === 'earlier' ? earlier : later };
  }

  return { ok: true, utc: local.toJSDate() };
}

/** Thrown by `localDateTimeToUtcOrThrow`; `reason` tells the UI which message to show. */
export class LocalTimeError extends Error {
  readonly reason: 'INVALID' | 'NONEXISTENT' | 'AMBIGUOUS';
  readonly earlier: Date | undefined;
  readonly later: Date | undefined;

  constructor(
    result: Extract<LocalToUtcResult, { ok: false }>,
    date: string,
    time: string,
    zone: string,
  ) {
    super(describeLocalTimeProblem(result, date, time, zone));
    this.name = 'LocalTimeError';
    this.reason = result.reason;
    this.earlier = result.reason === 'AMBIGUOUS' ? result.earlier : undefined;
    this.later = result.reason === 'AMBIGUOUS' ? result.later : undefined;
  }
}

function describeLocalTimeProblem(
  result: Extract<LocalToUtcResult, { ok: false }>,
  date: string,
  time: string,
  zone: string,
): string {
  switch (result.reason) {
    case 'INVALID':
      return `"${date} ${time}" in "${zone}" is not a valid date, time or time zone`;
    case 'NONEXISTENT':
      return `${date} ${time} does not exist in ${zone}: clocks jump forward for daylight saving time`;
    case 'AMBIGUOUS':
      return `${date} ${time} happens twice in ${zone} because clocks go back; choose the earlier or later one`;
  }
}

/** Like `localDateTimeToUtc`, but throws a `LocalTimeError` instead of returning a failure. */
export function localDateTimeToUtcOrThrow(
  date: string,
  time: string,
  zone: string,
  options: { ambiguous?: AmbiguousTimePolicy } = {},
): Date {
  const result = localDateTimeToUtc(date, time, zone, options);
  if (!result.ok) throw new LocalTimeError(result, date, time, zone);
  return result.utc;
}
