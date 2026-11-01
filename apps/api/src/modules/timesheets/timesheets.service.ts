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
  const canReview = (scope: Scope, auth: AuthContext, userId: string) =>
    userId !== auth.userId && (scope.reviewable?.has(userId) ?? true);
  /** Owners see their whole week; PMs see their own projects by name. */
  const gridProjects = (scope: Scope, auth: AuthContext, userId: string) =>
    userId === auth.userId ? null : scope.projectIds;

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

  async function detail(
    auth: AuthContext,
    user: Owner,
    weekStart: string,
    sheet: TimesheetWithPeople | null,
    scope: Scope,
  ) {
    const week = weekWindow(weekStart, user.timezone);
    const entries = await timesheets.completedEntries([
      { userId: user.id, start: week.start, end: week.end },
    ]);
    const grid = buildWeekGrid(entries, week, gridProjects(scope, auth, user.id));
    return {
      sheet,
      user,
      week,
      grid,
      canReview: sheet?.status === 'SUBMITTED' && canReview(scope, auth, user.id),
    };
  }

  async function weekTotal(user: Owner, weekStart: string): Promise<number> {
    const week = weekWindow(weekStart, user.timezone);
    const entries = await timesheets.completedEntries([
      { userId: user.id, start: week.start, end: week.end },
    ]);
    return buildWeekGrid(entries, week, null).totalSeconds;
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
    if (!canReview(scope, auth, sheet.userId))
      throw new ForbiddenError('Only a project manager or admin can review timesheets');
    if (!(await timesheets.review(id, decision, auth.userId, comment, clock()))) {
      throw new ConflictError('This timesheet is not awaiting approval', {
        code: ErrorCode.TIMESHEET_NOT_PENDING,
      });
    }
    await audit.record(
      decision === 'APPROVED' ? AuditAction.TIMESHEET_APPROVED : AuditAction.TIMESHEET_REJECTED,
      {
        actorId: auth.userId,
        targetType: 'timesheet',
        targetId: id,
        before: { status: sheet.status },
        after: {
          status: decision,
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

    /** Admins: everyone; PMs: their workers and themselves; workers: themselves. */
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
      const { items, total } = await timesheets.list(
        {
          ...(userIds && { userIds }),
          ...(query.reviewable && { excludeUserId: auth.userId }),
          ...(query.status && { status: query.status }),
          ...(query.from && { from: query.from }),
          ...(query.to && { to: query.to }),
        },
        query.page,
        query.pageSize,
      );
      const withWeeks = items.map((sheet) => ({
        sheet,
        week: weekWindow(fromDbDate(sheet.weekStart), sheet.user.timezone),
      }));
      const entries = await timesheets.completedEntries(
        withWeeks.map(({ sheet, week }) => ({ userId: sheet.userId, ...week })),
      );
      const rows = withWeeks.map(({ sheet, week }) => ({
        sheet,
        totalSeconds: buildWeekGrid(
          entries.filter((e) => e.userId === sheet.userId),
          week,
          null,
        ).totalSeconds,
      }));
      return { rows, total };
    },

    /** Locks the week for the owner until a reviewer rejects it. */
    async submit(auth: AuthContext, date: string, context: RequestContext) {
      const policy = await settings.getPolicy();
      if (!policy.timesheetApprovalEnabled) {
        throw new ConflictError('Timesheet approval is turned off for this organization', {
          code: ErrorCode.TIMESHEET_APPROVAL_DISABLED,
        });
      }
      const user = await owner(auth.userId);
      const weekStart = startOfWeekDate(date, policy.weekStartDay);
      const notSubmittable = (message: string) =>
        new ConflictError(message, { code: ErrorCode.TIMESHEET_NOT_SUBMITTABLE });
      if (weekStart > todayInZone(user.timezone, clock()))
        throw notSubmittable('This week hasn’t started yet');

      const week = weekWindow(weekStart, user.timezone);
      const sheet = await timesheets.transaction(async (tx) => {
        await timesheets.lockUser(tx, user.id);
        const existing = await timesheets.findByWeek(user.id, weekStart, tx);
        if (existing?.status === 'SUBMITTED')
          throw notSubmittable('This week is already submitted');
        if (existing?.status === 'APPROVED') throw notSubmittable('This week is already approved');
        if (await timesheets.findRunningBefore(user.id, week.end, tx))
          throw notSubmittable('Stop the running timer before submitting this week');
        return timesheets.submit(user.id, weekStart, clock(), tx);
      });

      await audit.record(
        AuditAction.TIMESHEET_SUBMITTED,
        {
          actorId: user.id,
          targetType: 'timesheet',
          targetId: sheet.id,
          after: {
            weekStart,
            weekEnd: addDays(weekStart, 6),
            totalSeconds: await weekTotal(user, weekStart),
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
