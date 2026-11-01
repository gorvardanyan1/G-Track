import { addDays } from './calendar.ts';

export const MAX_ENTRY_DURATION_SECONDS = 24 * 3600;
/** How far in the future an entry may end, to absorb small client/server clock differences. */
export const FUTURE_TOLERANCE_MS = 60_000;

export type EntryIntervalIssue = 'END_NOT_AFTER_START' | 'TOO_LONG' | 'IN_FUTURE';

export const ENTRY_INTERVAL_MESSAGES: Readonly<Record<EntryIntervalIssue, string>> = {
  END_NOT_AFTER_START: 'The end must be after the start',
  TOO_LONG: 'An entry can be at most 24 hours long',
  IN_FUTURE: 'An entry cannot end in the future',
};

/** Rules for a closed (start, end) entry; `now` is the server's time. */
export function validateEntryInterval(start: Date, end: Date, now: Date): EntryIntervalIssue[] {
  const issues: EntryIntervalIssue[] = [];
  const seconds = (end.getTime() - start.getTime()) / 1000;
  if (seconds <= 0) issues.push('END_NOT_AFTER_START');
  if (seconds > MAX_ENTRY_DURATION_SECONDS) issues.push('TOO_LONG');
  if (end.getTime() > now.getTime() + FUTURE_TOLERANCE_MS) issues.push('IN_FUTURE');
  return issues;
}

/**
 * Entries on a local date older than `lockAfterDays` days are locked: with 30, today minus 30
 * days is still editable, the day before is not. null disables age locking.
 */
export function isLockedByAge(
  localDate: string,
  today: string,
  lockAfterDays: number | null,
): boolean {
  return lockAfterDays !== null && localDate < addDays(today, -lockAfterDays);
}

/** Entries are stored with second precision; truncate instead of letting Postgres round. */
export function truncateToSecond(date: Date): Date {
  return new Date(Math.floor(date.getTime() / 1000) * 1000);
}
