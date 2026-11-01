import {
  addDays,
  ENTRY_INTERVAL_MESSAGES,
  ErrorCode,
  localDateTimeToUtc,
  startOfLocalDay,
  todayInZone,
  toLocalDateTime,
  truncateToSecond,
  UserRole,
  validateEntryInterval,
  type CreateTimeEntryRequest,
  type ListTimeEntriesQuery,
  type LocalDateTime,
  type UpdateTimeEntryRequest,
} from '@tempo/shared';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from '../../errors/app-error.ts';
import type { User } from '../../generated/prisma/client.ts';
import type { Clock } from '../../lib/clock.ts';
import type { EventBus } from '../../lib/event-bus.ts';
import type { RequestContext } from '../../lib/request-context.ts';
import { AuditAction } from '../audit/audit-actions.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { AuthContext } from '../auth/auth.types.ts';
import { isOverlapViolation, type EntryPolicy, type Owner } from './entry-policy.ts';
import type { EntryData, EntryWithRefs, TimeEntriesRepository } from './time-entries.repository.ts';

interface Deps {
  entries: TimeEntriesRepository;
  policy: EntryPolicy;
  audit: AuditService;
  clock: Clock;
  events: EventBus;
}

/** Converts a wall-clock input in the owner's zone, with an explicit error for DST problems. */
function toInstant(field: 'start' | 'end', local: LocalDateTime, zone: string): Date {
  const result = localDateTimeToUtc(
    local.date,
    local.time,
    zone,
    local.ambiguity ? { ambiguous: local.ambiguity } : {},
  );
  if (result.ok) return result.utc;
  const messages = {
    INVALID: 'is not a valid date or time',
    NONEXISTENT: `does not exist in ${zone}: clocks jump forward for daylight saving time`,
    AMBIGUOUS: `happens twice in ${zone} because clocks go back; choose "earlier" or "later"`,
  } as const;
  throw new ValidationError(
    [
      {
        path: field,
        code: result.reason,
        message: `${local.date} ${local.time} ${messages[result.reason]}`,
        ...(result.reason === 'AMBIGUOUS' && {
          earlier: result.earlier.toISOString(),
          later: result.later.toISOString(),
        }),
      },
    ],
    'Invalid local time',
    ErrorCode.INVALID_LOCAL_TIME,
  );
}

function assertValidInterval(start: Date, end: Date, now: Date): void {
  const issues = validateEntryInterval(start, end, now);
  if (issues.length > 0) {
    throw new ValidationError(
      issues.map((code) => ({ path: 'end', code, message: ENTRY_INTERVAL_MESSAGES[code] })),
      'Invalid time range',
      ErrorCode.INVALID_TIME_RANGE,
    );
  }
}

const snapshot = (e: EntryWithRefs) => ({
  projectId: e.projectId,
  taskId: e.taskId,
  description: e.description,
  isBillable: e.isBillable,
  startedAt: e.startedAt.toISOString(),
  endedAt: e.endedAt?.toISOString() ?? null,
  durationSeconds: e.durationSeconds,
});

export function createTimeEntriesService({ entries, policy, audit, clock, events }: Deps) {
  const now = () => truncateToSecond(clock());

  async function owner(userId: string): Promise<User> {
    const user = await entries.findUser(userId);
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  /** Visible = own entries, any entry for admins, entries on projects a PM manages. Else 404. */
  async function loadVisible(auth: AuthContext, id: string): Promise<EntryWithRefs> {
    const entry = await entries.findById(id);
    if (entry && entry.userId === auth.userId) return entry;
    if (entry && auth.role === UserRole.SUPER_ADMIN) return entry;
    if (
      entry &&
      auth.role === UserRole.PROJECT_MANAGER &&
      (await entries.managedProjectIds(auth.userId)).includes(entry.projectId)
    ) {
      return entry;
    }
    throw new NotFoundError('Time entry not found');
  }

  /** Only the owner edits entries; admins and PMs can see but not change them. */
  async function loadOwn(auth: AuthContext, id: string): Promise<EntryWithRefs> {
    const entry = await loadVisible(auth, id);
    if (entry.userId !== auth.userId)
      throw new ForbiddenError('Only the owner can change a time entry');
    return entry;
  }

  /** Overlap pre-check for a clear message; the exclusion constraint still guards races. */
  async function assertNoOverlap(user: Owner, start: Date, end: Date | null, excludeId?: string) {
    const conflict = await entries.findOverlap(user.id, start, end, excludeId);
    if (conflict) throw policy.overlapError(conflict, user.timezone);
  }

  async function save<T>(
    user: Owner,
    start: Date,
    end: Date | null,
    write: () => Promise<T>,
  ): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (isOverlapViolation(err)) {
        const conflict = await entries.findOverlap(user.id, start, end);
        if (conflict) throw policy.overlapError(conflict, user.timezone);
      }
      throw err;
    }
  }

  async function createManual(
    auth: AuthContext,
    input: CreateTimeEntryRequest,
    context: RequestContext,
  ) {
    const user = await owner(auth.userId);
    const startedAt = toInstant('start', input.start, user.timezone);
    const endedAt = toInstant('end', input.end, user.timezone);
    assertValidInterval(startedAt, endedAt, now());
    const project = await policy.assertCanTrack(user.id, input.projectId, input.taskId);
    await policy.assertEditable(user, startedAt, endedAt);
    await assertNoOverlap(user, startedAt, endedAt);

    const data: EntryData = {
      projectId: input.projectId,
      taskId: input.taskId,
      description: input.description,
      isBillable: input.isBillable ?? project.isBillable,
      startedAt,
      endedAt,
    };
    const entry = await save(user, startedAt, endedAt, () =>
      entries.create(user.id, data, 'MANUAL'),
    );
    await audit.record(
      AuditAction.TIME_ENTRY_CREATED,
      { actorId: user.id, targetType: 'time_entry', targetId: entry.id, after: snapshot(entry) },
      context,
    );
    events.publish({
      type: 'entry.saved',
      userId: user.id,
      entryId: entry.id,
      action: 'created',
      projectIds: [entry.projectId],
    });
    return entry;
  }

  return {
    /** Entries overlapping the local date range, in the *viewer's* timezone. */
    async list(auth: AuthContext, query: ListTimeEntriesQuery) {
      const viewer = await owner(auth.userId);
      const targetId = query.userId ?? auth.userId;
      let projectIds: string[] | undefined;

      if (targetId !== auth.userId) {
        const target = await entries.findUser(targetId);
        if (!target) throw new NotFoundError('User not found');
        if (auth.role === UserRole.PROJECT_MANAGER) {
          // A PM sees a worker's entries only on projects the PM manages.
          projectIds = await entries.managedProjectIds(auth.userId);
          if (!(await entries.isMemberOfAny(targetId, projectIds)))
            throw new NotFoundError('User not found');
        } else if (auth.role !== UserRole.SUPER_ADMIN) {
          throw new NotFoundError('User not found');
        }
      }

      const from = startOfLocalDay(query.from, viewer.timezone);
      const to = startOfLocalDay(addDays(query.to, 1), viewer.timezone);
      const list = await entries.listOverlapping(targetId, from, to, projectIds);
      const target = targetId === auth.userId ? viewer : await owner(targetId);
      const locked = targetId === auth.userId ? await policy.lockedEntryIds(target, list) : null;
      return list.map((entry) => ({ entry, editable: locked !== null && !locked.has(entry.id) }));
    },

    get: loadVisible,

    async editable(auth: AuthContext, entry: EntryWithRefs): Promise<boolean> {
      if (entry.userId !== auth.userId) return false;
      return !(await policy.lockedEntryIds(await owner(auth.userId), [entry])).has(entry.id);
    },

    createManual,

    async update(
      auth: AuthContext,
      id: string,
      input: UpdateTimeEntryRequest,
      context: RequestContext,
    ) {
      const entry = await loadOwn(auth, id);
      const user = await owner(auth.userId);
      await policy.assertEditable(user, entry.startedAt, entry.endedAt);

      const running = entry.endedAt === null;
      if (running && input.end)
        throw new BadRequestError('Stop the timer before setting an end time');
      const startedAt = input.start
        ? toInstant('start', input.start, user.timezone)
        : entry.startedAt;
      const endedAt = input.end ? toInstant('end', input.end, user.timezone) : entry.endedAt;
      if (endedAt) {
        assertValidInterval(startedAt, endedAt, now());
      } else if (startedAt > now()) {
        throw new ValidationError(
          [
            {
              path: 'start',
              code: 'IN_FUTURE',
              message: 'A running timer cannot start in the future',
            },
          ],
          'Invalid time range',
          ErrorCode.INVALID_TIME_RANGE,
        );
      }

      const projectId = input.projectId ?? entry.projectId;
      const taskId =
        input.taskId !== undefined
          ? input.taskId
          : input.projectId && input.projectId !== entry.projectId
            ? null
            : entry.taskId;
      const project = await policy.assertCanTrack(user.id, projectId, taskId);
      if (input.start || input.end) await policy.assertEditable(user, startedAt, endedAt);
      await assertNoOverlap(user, startedAt, endedAt, entry.id);

      const updated = await save(user, startedAt, endedAt, () =>
        entries.update(entry.id, {
          projectId,
          taskId,
          description: input.description ?? entry.description,
          isBillable:
            input.isBillable ??
            (input.projectId && input.projectId !== entry.projectId
              ? project.isBillable
              : entry.isBillable),
          startedAt,
          endedAt,
        }),
      );
      await audit.record(
        AuditAction.TIME_ENTRY_UPDATED,
        {
          actorId: user.id,
          targetType: 'time_entry',
          targetId: entry.id,
          before: snapshot(entry),
          after: snapshot(updated),
        },
        context,
      );
      events.publish({
        type: 'entry.saved',
        userId: user.id,
        entryId: entry.id,
        action: 'updated',
        projectIds: [...new Set([entry.projectId, updated.projectId])],
      });
      return updated;
    },

    async remove(auth: AuthContext, id: string, context: RequestContext) {
      const entry = await loadOwn(auth, id);
      await policy.assertEditable(await owner(auth.userId), entry.startedAt, entry.endedAt);
      await entries.delete(entry.id);
      await audit.record(
        AuditAction.TIME_ENTRY_DELETED,
        {
          actorId: auth.userId,
          targetType: 'time_entry',
          targetId: entry.id,
          before: snapshot(entry),
        },
        context,
      );
      events.publish({
        type: 'entry.deleted',
        userId: auth.userId,
        entryId: entry.id,
        projectIds: [entry.projectId],
      });
    },

    /** Copies an entry to another local date at the same local times (default: today). */
    async duplicate(
      auth: AuthContext,
      id: string,
      date: string | undefined,
      context: RequestContext,
    ) {
      const entry = await loadOwn(auth, id);
      if (!entry.endedAt) throw new BadRequestError('Stop the timer before duplicating it');
      const user = await owner(auth.userId);
      const start = toLocalDateTime(entry.startedAt, user.timezone);
      const end = toLocalDateTime(entry.endedAt, user.timezone);
      const target = date ?? todayInZone(user.timezone, clock());
      const dayShift = (Date.parse(end.date) - Date.parse(start.date)) / 86_400_000;
      return createManual(
        auth,
        {
          projectId: entry.projectId,
          taskId: entry.taskId,
          description: entry.description,
          isBillable: entry.isBillable,
          start: { date: target, time: start.time, ambiguity: 'earlier' },
          end: { date: addDays(target, dayShift), time: end.time, ambiguity: 'later' },
        },
        context,
      );
    },
  };
}

export type TimeEntriesService = ReturnType<typeof createTimeEntriesService>;
