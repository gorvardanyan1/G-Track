import {
  addDays,
  ErrorCode,
  startOfWeekDate,
  todayInZone,
  UserRole,
  type ListTimesheetsQuery,
} from '@tempo/shared';
import { ConflictError, ForbiddenError, NotFoundError } from '../../errors/app-error.ts';
import type { Clock } from '../../lib/clock.ts';
import { pgErrorCode } from '../../lib/prisma-errors.ts';
import type { EventBus } from '../../lib/event-bus.ts';
import type { RequestContext } from '../../lib/request-context.ts';
import { AuditAction } from '../audit/audit-actions.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { AuthContext } from '../auth/auth.types.ts';
import type { SettingsRepository } from '../settings/settings.repository.ts';
import { buildWeekGrid, weekWindow } from './timesheet-grid.ts';
import {
  fromDbDate,
  type TimesheetsRepository,
  type TimesheetWithPeople,
} from './timesheets.repository.ts';

interface Deps {
  timesheets: TimesheetsRepository;
  settings: SettingsRepository;
  audit: AuditService;
  clock: Clock;
  events: EventBus;
}

interface Owner {
  id: string;
  name: string;
  timezone: string;
}

/** What a viewer may see: null = everything (admin); else the people and projects in scope. */
interface Scope {
  isAdmin: boolean;
  /** People whose timesheets the viewer may see (always includes themselves). */
  userIds: Set<string> | null;
  /** People the viewer may review. */
  reviewable: Set<string> | null;
  /** Projects shown by name in the grid; null = all. */
  projectIds: Set<string> | null;
}

export function createTimesheetsService({ timesheets, settings, audit, clock, events }: Deps) {
  async function scopeOf(auth: AuthContext): Promise<Scope> {
    if (auth.role === UserRole.SUPER_ADMIN)
      return { isAdmin: true, userIds: null, reviewable: null, projectIds: null };
    if (auth.role === UserRole.PROJECT_MANAGER) {
      const projectIds = await timesheets.managedProjectIds(auth.userId);
      const workers = new Set(await timesheets.workerIdsOn(projectIds));
      workers.delete(auth.userId);
      return {
        isAdmin: false,
        userIds: new Set([...workers, auth.userId]),
        reviewable: workers,
        projectIds: new Set(projectIds),
      };
    }
    return {
      isAdmin: false,
      userIds: new Set([auth.userId]),
      reviewable: new Set(),
      projectIds: null,
    };
  }

  const canSee = (scope: Scope, userId: string) => scope.userIds?.has(userId) ?? true;
  /** Owners see their whole week; PMs see their own projects by name. */
  const gridProjects = (scope: Scope, auth: AuthContext, userId: string) =>
    userId === auth.userId ? null : scope.projectIds;

  /**
   * Who decides one part of a week: a project's part by its PM (or a Super Admin); the
   * whole-week part of a week without time by any of the owner's PMs (or a Super Admin).
   * Never the owner.
   */
  function decidesPart(
    scope: Scope,
    auth: AuthContext,
    ownerId: string,
    part: { projectId: string | null },
  ): boolean {
    if (ownerId === auth.userId) return false;
    if (scope.isAdmin) return true;
    // PMs review the workers on their projects (the people they can see), …
    if (!scope.reviewable?.has(ownerId)) return false;
    // … and of each week only the parts of projects they manage.
    return part.projectId === null || (scope.projectIds?.has(part.projectId) ?? false);
  }
  /** A project the viewer can't see stays anonymous (like everywhere else: no names leak). */
  const seesPart = (scope: Scope, auth: AuthContext, ownerId: string, projectId: string | null) =>
    ownerId === auth.userId ||
    scope.isAdmin ||
    projectId === null ||
    (scope.projectIds?.has(projectId) ?? false);
  const pendingFor = (scope: Scope, auth: AuthContext, sheet: TimesheetWithPeople) =>
    sheet.status === 'SUBMITTED'
      ? sheet.reviews.filter(
          (r) => r.status === 'PENDING' && decidesPart(scope, auth, sheet.userId, r),
        )
      : [];

  async function owner(userId: string): Promise<Owner> {
    const user = await timesheets.findUser(userId);
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  async function loadVisible(auth: AuthContext, id: string) {
    const sheet = await timesheets.findById(id);
    const scope = await scopeOf(auth);
    if (!sheet || !canSee(scope, sheet.userId)) throw new NotFoundError('Timesheet not found');
    return { sheet, scope };
  }

  /**
   * The week's window. A submitted or approved week uses the timezone and UTC period fixed at
   * submission (a later profile change can't move time in or out); otherwise the owner's zone.
   */
  function windowOf(weekStart: string, user: Owner, sheet: TimesheetWithPeople | null) {
    const locked = sheet?.status === 'SUBMITTED' || sheet?.status === 'APPROVED';
    if (locked && sheet.timezone && sheet.periodStart && sheet.periodEnd) {
      return {
        ...weekWindow(weekStart, sheet.timezone),
        start: sheet.periodStart,
        end: sheet.periodEnd,
      };
    }
    return weekWindow(weekStart, user.timezone);
  }
  /** Locked weeks show the total fixed at submission. */
  const lockedTotal = (sheet: TimesheetWithPeople | null) =>
    (sheet?.status === 'SUBMITTED' || sheet?.status === 'APPROVED') && sheet.totalSeconds !== null
      ? sheet.totalSeconds
      : null;

  async function detail(
    auth: AuthContext,
    user: Owner,
    weekStart: string,
    sheet: TimesheetWithPeople | null,
    scope: Scope,
  ) {
    const week = windowOf(weekStart, user, sheet);
    const entries = await timesheets.completedEntries([
      { userId: user.id, start: week.start, end: week.end },
    ]);
    const grid = buildWeekGrid(entries, week, gridProjects(scope, auth, user.id));
    const decides = sheet ? new Set(pendingFor(scope, auth, sheet).map((r) => r.id)) : new Set();
    return {
      sheet,
      user,
      week,
      grid,
      totalSeconds: lockedTotal(sheet) ?? grid.totalSeconds,
      reviews: (sheet?.reviews ?? []).map((r) => ({
        review: r,
        visible: seesPart(scope, auth, user.id, r.projectId),
        canReview: decides.has(r.id),
      })),
      canReview: decides.size > 0,
    };
  }

  async function review(
    auth: AuthContext,
    id: string,
    decision: 'APPROVED' | 'REJECTED',
    comment: string | null,
    context: RequestContext,
  ) {
    const { sheet, scope } = await loadVisible(auth, id);
    if (sheet.userId === auth.userId)
      throw new ForbiddenError('You can’t review your own timesheet');
    const notPending = () =>
      new ConflictError('This timesheet is not awaiting approval', {
        code: ErrorCode.TIMESHEET_NOT_PENDING,
      });
    if (sheet.status !== 'SUBMITTED') throw notPending();
    const mine = pendingFor(scope, auth, sheet);
    if (mine.length === 0) {
      if (sheet.reviews.some((r) => r.status === 'PENDING'))
        throw new ForbiddenError(
          'Only the manager of each project (or an admin) can review its part of the week',
        );
      throw notPending();
    }

    const at = clock();
    const outcome = await timesheets.transaction(async (tx) => {
      if ((await timesheets.lockSheet(tx, id)) !== 'SUBMITTED') return null;
      const decided = await timesheets.decideParts(
        tx,
        mine.map((r) => r.id),
        decision,
        auth.userId,
        comment,
        at,
      );
      // Another reviewer decided some of these parts in the meantime.
      if (decided !== mine.length) return null;
      const statuses = await timesheets.partStatuses(tx, id);
      const status =
        decision === 'REJECTED'
          ? ('REJECTED' as const)
          : statuses.every((s) => s === 'APPROVED')
            ? ('APPROVED' as const)
            : ('SUBMITTED' as const);
      if (status !== 'SUBMITTED')
        await timesheets.setOutcome(tx, id, status, auth.userId, comment, at);
      return status;
    });
    if (outcome === null) throw notPending();

    await audit.record(
      decision === 'APPROVED' ? AuditAction.TIMESHEET_APPROVED : AuditAction.TIMESHEET_REJECTED,
      {
        actorId: auth.userId,
        targetType: 'timesheet',
        targetId: id,
        before: { status: sheet.status },
        after: {
          decision,
          status: outcome,
          projectIds: mine.map((r) => r.projectId),
          comment,
          userId: sheet.userId,
          weekStart: fromDbDate(sheet.weekStart),
        },
      },
      context,
    );
    events.publish({ type: 'timesheet.changed', userId: sheet.userId, timesheetId: id });
    const updated = await timesheets.findById(id);
    return detail(auth, sheet.user, fromDbDate(sheet.weekStart), updated, scope);
  }

  return {
    /** The caller's own week containing `date` (a virtual DRAFT if never submitted). */
    async mine(auth: AuthContext, date: string) {
      const user = await owner(auth.userId);
      const { weekStartDay } = await settings.getPolicy();
      const weekStart = startOfWeekDate(date, weekStartDay);
      const sheet = await timesheets.findByWeek(user.id, weekStart);
      return detail(auth, user, weekStart, sheet, await scopeOf(auth));
    },

    async get(auth: AuthContext, id: string) {
      const { sheet, scope } = await loadVisible(auth, id);
      return detail(auth, sheet.user, fromDbDate(sheet.weekStart), sheet, scope);
    },

    /**
     * Admins: everyone; PMs: their workers and themselves; workers: themselves. With
     * `reviewable` and status SUBMITTED: only weeks with a part waiting for this reviewer.
     */
    async list(auth: AuthContext, query: ListTimesheetsQuery) {
      const scope = await scopeOf(auth);
      if (query.userId && !canSee(scope, query.userId)) throw new NotFoundError('User not found');
      const visible = query.reviewable ? scope.reviewable : scope.userIds;
      const userIds = query.userId
        ? visible && !visible.has(query.userId)
          ? []
          : [query.userId]
        : visible
          ? [...visible]
          : undefined;
      const waiting = query.reviewable && query.status === 'SUBMITTED';
      const { items, total } = await timesheets.list(
        {
          ...(userIds && { userIds }),
          ...(query.reviewable && { excludeUserId: auth.userId }),
          ...(query.status && { status: query.status }),
          ...(query.from && { from: query.from }),
          ...(query.to && { to: query.to }),
          ...(waiting && {
            pendingFor: scope.isAdmin
              ? { projectIds: null, wholeWeekUserIds: null }
              : {
                  projectIds: [...(scope.projectIds ?? [])],
                  wholeWeekUserIds: [...(scope.reviewable ?? [])],
                },
          }),
        },
        query.page,
        query.pageSize,
      );
      const withWeeks = items.map((sheet) => ({
        sheet,
        week: windowOf(fromDbDate(sheet.weekStart), sheet.user, sheet),
      }));
      const entries = await timesheets.completedEntries(
        withWeeks.map(({ sheet, week }) => ({ userId: sheet.userId, ...week })),
      );
      const rows = withWeeks.map(({ sheet, week }) => ({
        sheet,
        totalSeconds:
          lockedTotal(sheet) ??
          buildWeekGrid(
            entries.filter((e) => e.userId === sheet.userId),
            week,
            null,
          ).totalSeconds,
      }));
      return { rows, total };
    },

    /**
     * Locks a finished week for the owner until a reviewer returns it. The week's period, total
     * and per-project parts are fixed now, in the owner's current timezone.
     */
    async submit(auth: AuthContext, date: string, context: RequestContext) {
      const policy = await settings.getPolicy();
      if (!policy.timesheetApprovalEnabled) {
        throw new ConflictError('Timesheet approval is turned off for this organization', {
          code: ErrorCode.TIMESHEET_APPROVAL_DISABLED,
        });
      }
      const user = await owner(auth.userId);
      const weekStart = startOfWeekDate(date, policy.weekStartDay);
      const weekEnd = addDays(weekStart, 6);
      const notSubmittable = (message: string) =>
        new ConflictError(message, { code: ErrorCode.TIMESHEET_NOT_SUBMITTABLE });
      // Submitting locks the whole week, so it must be over (else the rest of it is frozen).
      if (weekEnd >= todayInZone(user.timezone, clock()))
        throw notSubmittable(`This week isn’t over yet; submit it after ${weekEnd}`);

      const week = weekWindow(weekStart, user.timezone);
      let sheet: TimesheetWithPeople;
      try {
        sheet = await timesheets.transaction(async (tx) => {
          await timesheets.lockUser(tx, user.id);
          const existing = await timesheets.findByWeek(user.id, weekStart, tx);
          if (existing?.status === 'SUBMITTED')
            throw notSubmittable('This week is already submitted');
          if (existing?.status === 'APPROVED')
            throw notSubmittable('This week is already approved');
          if (await timesheets.findRunningBefore(user.id, week.end, tx))
            throw notSubmittable('Stop the running timer before submitting this week');
          const grid = buildWeekGrid(
            await timesheets.completedEntries([{ userId: user.id, ...week }], tx),
            week,
            null,
          );
          const parts = grid.projects.map((row) => ({
            projectId: row.project.id,
            seconds: row.totalSeconds,
          }));
          return timesheets.submit(
            user.id,
            weekStart,
            clock(),
            {
              timezone: user.timezone,
              periodStart: week.start,
              periodEnd: week.end,
              totalSeconds: grid.totalSeconds,
              parts: parts.length > 0 ? parts : [{ projectId: null, seconds: 0 }],
            },
            tx,
          );
        });
      } catch (err) {
        if (pgErrorCode(err) === '23P01')
          throw notSubmittable('This week overlaps a week that is already submitted or approved');
        throw err;
      }

      await audit.record(
        AuditAction.TIMESHEET_SUBMITTED,
        {
          actorId: user.id,
          targetType: 'timesheet',
          targetId: sheet.id,
          after: {
            weekStart,
            weekEnd,
            totalSeconds: sheet.totalSeconds,
            projectIds: sheet.reviews.map((r) => r.projectId),
          },
        },
        context,
      );
      events.publish({ type: 'timesheet.changed', userId: user.id, timesheetId: sheet.id });
      return detail(auth, user, weekStart, sheet, await scopeOf(auth));
    },

    approve: (auth: AuthContext, id: string, comment: string | null, context: RequestContext) =>
      review(auth, id, 'APPROVED', comment, context),

    reject: (auth: AuthContext, id: string, comment: string, context: RequestContext) =>
      review(auth, id, 'REJECTED', comment, context),
  };
}

export type TimesheetsService = ReturnType<typeof createTimesheetsService>;
export type TimesheetDetail = Awaited<ReturnType<TimesheetsService['get']>>;
