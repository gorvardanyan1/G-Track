import type { PrismaClient } from '../../db/prisma.ts';
import type {
  Prisma,
  TimesheetReviewStatus,
  TimesheetStatus,
} from '../../generated/prisma/client.ts';

type Tx = Prisma.TransactionClient;

const include = {
  user: { select: { id: true, name: true, timezone: true } },
  reviewer: { select: { id: true, name: true } },
  reviews: {
    include: {
      project: { select: { id: true, name: true, color: true } },
      reviewer: { select: { id: true, name: true } },
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.TimesheetInclude;

export type TimesheetWithPeople = Prisma.TimesheetGetPayload<{ include: typeof include }>;
export type TimesheetReviewRow = TimesheetWithPeople['reviews'][number];

/** The fixed facts of a submission: the week's period in UTC, and each project's part. */
export interface Submission {
  timezone: string;
  periodStart: Date;
  periodEnd: Date;
  totalSeconds: number;
  /** One per project with time in the week; a week without time has one whole-week part. */
  parts: { projectId: string | null; seconds: number }[];
}

/** Sheets with a part waiting for this reviewer (admins: any part). */
export interface PendingFor {
  /** Projects whose parts the reviewer decides; null = every project (Super Admin). */
  projectIds: string[] | null;
  /** Owners whose whole-week parts the reviewer decides; null = everyone. */
  wholeWeekUserIds: string[] | null;
}

/** "YYYY-MM-DD" ↔ the DATE column (Prisma maps DATE to midnight UTC). */
export const toDbDate = (date: string) => new Date(`${date}T00:00:00Z`);
export const fromDbDate = (date: Date) => date.toISOString().slice(0, 10);

export interface TimesheetFilter {
  /** Undefined = everyone (Super Admin). */
  userIds?: string[];
  status?: TimesheetStatus;
  from?: string;
  to?: string;
  /** Leave out one person's timesheets (a reviewer's own). */
  excludeUserId?: string;
  /** Only sheets with a part this reviewer still has to decide. */
  pendingFor?: PendingFor;
}

export interface EntryWindow {
  userId: string;
  start: Date;
  end: Date;
}

export function createTimesheetsRepository(prisma: PrismaClient) {
  return {
    transaction: <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction(fn),

    /** Same per-user lock the timer takes, so submitting and starting a timer serialize. */
    async lockUser(tx: Tx, userId: string): Promise<void> {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    },

    findById: (id: string) => prisma.timesheet.findUnique({ where: { id }, include }),

    findByWeek: (userId: string, weekStart: string, db: Tx | PrismaClient = prisma) =>
      db.timesheet.findUnique({
        where: { userId_weekStart: { userId, weekStart: toDbDate(weekStart) } },
        include,
      }),

    async list(filter: TimesheetFilter, page: number, pageSize: number) {
      const where: Prisma.TimesheetWhereInput = {
        ...(filter.userIds && { userId: { in: filter.userIds } }),
        ...(filter.excludeUserId && { NOT: { userId: filter.excludeUserId } }),
        ...(filter.status && { status: filter.status }),
        ...(filter.pendingFor && {
          reviews: {
            some: {
              status: 'PENDING' as const,
              ...(filter.pendingFor.projectIds !== null && {
                OR: [
                  { projectId: { in: filter.pendingFor.projectIds } },
                  {
                    projectId: null,
                    ...(filter.pendingFor.wholeWeekUserIds !== null && {
                      timesheet: { userId: { in: filter.pendingFor.wholeWeekUserIds } },
                    }),
                  },
                ],
              }),
            },
          },
        }),
        ...((filter.from || filter.to) && {
          weekStart: {
            ...(filter.from && { gte: toDbDate(filter.from) }),
            ...(filter.to && { lte: toDbDate(filter.to) }),
          },
        }),
      };
      const [items, total] = await prisma.$transaction([
        prisma.timesheet.findMany({
          where,
          include,
          orderBy: [{ weekStart: 'desc' }, { submittedAt: 'asc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.timesheet.count({ where }),
      ]);
      return { items, total };
    },

    /**
     * (Re)submits a week: fixes its period and total, clears the previous review and opens one
     * part per project. Throws if it overlaps another locked week (database exclusion).
     */
    async submit(userId: string, weekStart: string, at: Date, submission: Submission, db: Tx) {
      const fixed = {
        status: 'SUBMITTED' as const,
        submittedAt: at,
        timezone: submission.timezone,
        periodStart: submission.periodStart,
        periodEnd: submission.periodEnd,
        totalSeconds: submission.totalSeconds,
      };
      const sheet = await db.timesheet.upsert({
        where: { userId_weekStart: { userId, weekStart: toDbDate(weekStart) } },
        create: { userId, weekStart: toDbDate(weekStart), ...fixed },
        update: { ...fixed, reviewerId: null, reviewedAt: null, comment: null },
      });
      await db.timesheetReview.deleteMany({ where: { timesheetId: sheet.id } });
      await db.timesheetReview.createMany({
        data: submission.parts.map((part) => ({ timesheetId: sheet.id, ...part })),
      });
      return db.timesheet.findUniqueOrThrow({ where: { id: sheet.id }, include });
    },

    /** Serializes reviews of one sheet (two PMs approving their parts at the same moment). */
    async lockSheet(tx: Tx, id: string): Promise<TimesheetStatus | null> {
      const rows = await tx.$queryRaw<{ status: TimesheetStatus }[]>`
        SELECT status FROM timesheets WHERE id = ${id}::uuid FOR UPDATE`;
      return rows[0]?.status ?? null;
    },

    /** Decides pending parts; returns how many were still pending (and so were decided). */
    async decideParts(
      tx: Tx,
      reviewIds: string[],
      status: Exclude<TimesheetReviewStatus, 'PENDING'>,
      reviewerId: string,
      comment: string | null,
      at: Date,
    ): Promise<number> {
      const { count } = await tx.timesheetReview.updateMany({
        where: { id: { in: reviewIds }, status: 'PENDING' },
        data: { status, reviewerId, reviewedAt: at, comment },
      });
      return count;
    },

    partStatuses: async (tx: Tx, timesheetId: string) =>
      (await tx.timesheetReview.findMany({ where: { timesheetId }, select: { status: true } })).map(
        (r) => r.status,
      ),

    /** The week's outcome once every part is approved, or as soon as one part is returned. */
    setOutcome: (
      tx: Tx,
      id: string,
      status: 'APPROVED' | 'REJECTED',
      reviewerId: string,
      comment: string | null,
      at: Date,
    ) =>
      tx.timesheet.update({
        where: { id },
        data: { status, reviewerId, reviewedAt: at, comment },
      }),

    findUser: (id: string) =>
      prisma.user.findUnique({ where: { id }, select: { id: true, name: true, timezone: true } }),

    /** A running timer that started before `before` (it then reaches into that week). */
    findRunningBefore: (userId: string, before: Date, db: Tx) =>
      db.timeEntry.findFirst({ where: { userId, endedAt: null, startedAt: { lt: before } } }),

    /** Completed entries overlapping each window, in one query. */
    completedEntries: (windows: EntryWindow[], db: Tx | PrismaClient = prisma) =>
      windows.length === 0
        ? Promise.resolve([])
        : db.timeEntry.findMany({
            where: {
              endedAt: { not: null },
              OR: windows.map((w) => ({
                userId: w.userId,
                startedAt: { lt: w.end },
                endedAt: { gt: w.start },
              })),
            },
            include: { project: { select: { id: true, name: true, color: true } } },
          }),

    /** Projects the PM manages (PM membership; the caller checks the global role). */
    async managedProjectIds(pmId: string): Promise<string[]> {
      const rows = await prisma.projectMember.findMany({
        where: { userId: pmId, roleInProject: 'PM' },
        select: { projectId: true },
      });
      return rows.map((r) => r.projectId);
    },

    /** Workers on any of `projectIds` — the people a PM reviews. */
    async workerIdsOn(projectIds: string[]): Promise<string[]> {
      const rows = await prisma.projectMember.findMany({
        where: { projectId: { in: projectIds }, roleInProject: 'WORKER' },
        select: { userId: true },
        distinct: ['userId'],
      });
      return rows.map((r) => r.userId);
    },
  };
}

export type TimesheetsRepository = ReturnType<typeof createTimesheetsRepository>;
