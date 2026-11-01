import {
  ErrorCode,
  isLockedByAge,
  splitByLocalDay,
  todayInZone,
  toLocalDate,
  toLocalDateTime,
} from '@tempo/shared';
import { ConflictError, NotFoundError } from '../../errors/app-error.ts';
import type { Clock } from '../../lib/clock.ts';
import { pgErrorCode } from '../../lib/prisma-errors.ts';
import type { OrgPolicy, SettingsRepository } from '../settings/settings.repository.ts';
import type { EntryWithRefs, TimeEntriesRepository } from './time-entries.repository.ts';

interface Deps {
  entries: TimeEntriesRepository;
  settings: SettingsRepository;
  clock: Clock;
}

export interface Owner {
  id: string;
  timezone: string;
}

/** Shared by the timer and manual entries: what may be tracked, and which periods are frozen. */
export function createEntryPolicy({ entries, settings, clock }: Deps) {
  /** Local dates (owner's zone) an interval touches; running entries extend to now. */
  function datesOf(start: Date, end: Date | null, zone: string): string[] {
    const until = end ?? clock();
    const dates = until > start ? splitByLocalDay(start, until, zone).map((p) => p.date) : [];
    return dates.length > 0 ? dates : [toLocalDate(start, zone)];
  }

  /** The span an interval occupies; a running entry reaches to now, a point covers 1 ms. */
  function spanOf(start: Date, end: Date | null) {
    const until = (end ?? clock()).getTime();
    return { start: start.getTime(), end: Math.max(until, start.getTime() + 1) };
  }

  type Period = { periodStart: Date | null; periodEnd: Date | null };
  const overlaps = (span: { start: number; end: number }, p: Period) =>
    p.periodStart !== null &&
    p.periodEnd !== null &&
    p.periodStart.getTime() < span.end &&
    p.periodEnd.getTime() > span.start;

  /**
   * Why an interval can't change: older than the org's lock period, or overlapping a submitted
   * or approved week. Weeks lock by the UTC period fixed at submission, so changing one's
   * timezone can't move time in or out of them; approved weeks stay read-only even if approval
   * is later switched off or the week start day changes.
   */
  function lockReason(
    dates: string[],
    span: { start: number; end: number },
    today: string,
    policy: OrgPolicy,
    periods: Period[],
  ) {
    if (dates.some((date) => isLockedByAge(date, today, policy.lockAfterDays)))
      return 'AGE' as const;
    return periods.some((p) => overlaps(span, p)) ? ('TIMESHEET' as const) : null;
  }

  return {
    policy: () => settings.getPolicy(),

    /** Throws 409 PERIOD_LOCKED if the interval touches a locked or submitted/approved period. */
    async assertEditable(
      owner: Owner,
      start: Date,
      end: Date | null,
      policy?: OrgPolicy,
    ): Promise<void> {
      const span = spanOf(start, end);
      const reason = lockReason(
        datesOf(start, end, owner.timezone),
        span,
        todayInZone(owner.timezone, clock()),
        policy ?? (await settings.getPolicy()),
        await entries.lockedPeriods(owner.id, new Date(span.start), new Date(span.end)),
      );
      if (reason === 'AGE') {
        throw new ConflictError('This period is locked and can no longer be changed', {
          code: ErrorCode.PERIOD_LOCKED,
        });
      }
      if (reason === 'TIMESHEET') {
        throw new ConflictError('This week’s timesheet has been submitted or approved', {
          code: ErrorCode.PERIOD_LOCKED,
        });
      }
    },

    /** Batch version for lists: one timesheet query for all entries. */
    async lockedEntryIds(owner: Owner, list: EntryWithRefs[]): Promise<Set<string>> {
      const policy = await settings.getPolicy();
      const today = todayInZone(owner.timezone, clock());
      const spans = new Map(list.map((e) => [e.id, spanOf(e.startedAt, e.endedAt)]));
      const all = [...spans.values()];
      const periods =
        all.length === 0
          ? []
          : await entries.lockedPeriods(
              owner.id,
              new Date(Math.min(...all.map((x) => x.start))),
              new Date(Math.max(...all.map((x) => x.end))),
            );
      const locked = new Set<string>();
      for (const entry of list) {
        const dates = datesOf(entry.startedAt, entry.endedAt, owner.timezone);
        if (lockReason(dates, spans.get(entry.id)!, today, policy, periods)) locked.add(entry.id);
      }
      return locked;
    },

    /** The user must be assigned to the (non-archived) project; the task must belong to it. */
    async assertCanTrack(userId: string, projectId: string, taskId: string | null) {
      const membership = await entries.findMembership(projectId, userId);
      if (!membership) throw new NotFoundError('Project not found');
      if (membership.project.archivedAt) throw new ConflictError('Project is archived');
      if (taskId && !(await entries.findTask(projectId, taskId)))
        throw new NotFoundError('Task not found');
      return membership.project;
    },

    /** Clear, user-facing overlap error naming the conflicting entry in the owner's zone. */
    overlapError(conflict: EntryWithRefs, zone: string): ConflictError {
      const start = toLocalDateTime(conflict.startedAt, zone);
      const end = conflict.endedAt ? toLocalDateTime(conflict.endedAt, zone) : null;
      const when = end
        ? `${start.date} ${start.time.slice(0, 5)}–${end.date === start.date ? '' : `${end.date} `}${end.time.slice(0, 5)}`
        : `the timer running since ${start.date} ${start.time.slice(0, 5)}`;
      const label = conflict.description || conflict.project.name;
      return new ConflictError(`Overlaps “${label}” (${when})`, {
        code: ErrorCode.TIME_ENTRY_OVERLAP,
        details: {
          entryId: conflict.id,
          startedAt: conflict.startedAt.toISOString(),
          endedAt: conflict.endedAt?.toISOString() ?? null,
        },
      });
    },
  };
}

export type EntryPolicy = ReturnType<typeof createEntryPolicy>;

/** The database's own guards fired (a concurrent request won the race). */
export function isOverlapViolation(err: unknown): boolean {
  const code = pgErrorCode(err);
  return (
    code === '23P01' || code === '23505' || String(err).includes('time_entries_no_overlap_per_user')
  );
}
