import type { PrismaClient } from '../../db/prisma.ts';
import type { Prisma, TimesheetStatus } from '../../generated/prisma/client.ts';

type Tx = Prisma.TransactionClient;

const include = {
  user: { select: { id: true, name: true, timezone: true } },
  reviewer: { select: { id: true, name: true } },
} satisfies Prisma.TimesheetInclude;

export type TimesheetWithPeople = Prisma.TimesheetGetPayload<{ include: typeof include }>;

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

    /** (Re)submits a week: clears the previous review. */
    submit: (userId: string, weekStart: string, at: Date, db: Tx) =>
      db.timesheet.upsert({
        where: { userId_weekStart: { userId, weekStart: toDbDate(weekStart) } },
        create: { userId, weekStart: toDbDate(weekStart), status: 'SUBMITTED', submittedAt: at },
        update: {
          status: 'SUBMITTED',
          submittedAt: at,
          reviewerId: null,
          reviewedAt: null,
          comment: null,
        },
        include,
      }),

    /** Atomic SUBMITTED → APPROVED/REJECTED; false if it was no longer pending. */
    async review(
      id: string,
      status: 'APPROVED' | 'REJECTED',
      reviewerId: string,
      comment: string | null,
      at: Date,
    ): Promise<boolean> {
      const { count } = await prisma.timesheet.updateMany({
        where: { id, status: 'SUBMITTED' },
        data: { status, reviewerId, reviewedAt: at, comment },
      });
      return count === 1;
    },

    findUser: (id: string) =>
      prisma.user.findUnique({ where: { id }, select: { id: true, name: true, timezone: true } }),

    /** A running timer that started before `before` (it then reaches into that week). */
    findRunningBefore: (userId: string, before: Date, db: Tx) =>
      db.timeEntry.findFirst({ where: { userId, endedAt: null, startedAt: { lt: before } } }),

    /** Completed entries overlapping each window, in one query. */
    completedEntries: (windows: EntryWindow[]) =>
      windows.length === 0
        ? Promise.resolve([])
        : prisma.timeEntry.findMany({
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
