import type { PrismaClient } from '../../db/prisma.ts';
import type { Prisma, TimeEntrySource } from '../../generated/prisma/client.ts';

export const entryInclude = {
  project: { select: { id: true, name: true, color: true } },
  task: { select: { id: true, name: true } },
} satisfies Prisma.TimeEntryInclude;

export type EntryWithRefs = Prisma.TimeEntryGetPayload<{ include: typeof entryInclude }>;
type Tx = Prisma.TransactionClient;

export interface EntryData {
  projectId: string;
  taskId: string | null;
  description: string;
  isBillable: boolean;
  startedAt: Date;
  endedAt: Date | null;
}

export function createTimeEntriesRepository(prisma: PrismaClient) {
  return {
    transaction: <T>(fn: (tx: Tx) => Promise<T>) => prisma.$transaction(fn),

    /** Serializes timer changes per user: concurrent starts/stops queue up on this row lock. */
    async lockUser(tx: Tx, userId: string): Promise<void> {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    },

    findRunning: (userId: string, db: Tx | PrismaClient = prisma) =>
      db.timeEntry.findFirst({ where: { userId, endedAt: null }, include: entryInclude }),

    findById: (id: string) => prisma.timeEntry.findUnique({ where: { id }, include: entryInclude }),

    /** First entry of the user overlapping [start, end) — end null means "open ended". */
    findOverlap: (userId: string, start: Date, end: Date | null, excludeId?: string) =>
      prisma.timeEntry.findFirst({
        where: {
          userId,
          ...(excludeId && { id: { not: excludeId } }),
          ...(end && { startedAt: { lt: end } }),
          OR: [{ endedAt: null }, { endedAt: { gt: start } }],
        },
        include: entryInclude,
        orderBy: { startedAt: 'asc' },
      }),

    /** Entries overlapping [from, to), optionally only on some projects. */
    listOverlapping: (userId: string, from: Date, to: Date, projectIds?: string[]) =>
      prisma.timeEntry.findMany({
        where: {
          userId,
          startedAt: { lt: to },
          OR: [{ endedAt: null }, { endedAt: { gt: from } }],
          ...(projectIds && { projectId: { in: projectIds } }),
        },
        include: entryInclude,
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      }),

    create: (
      userId: string,
      data: EntryData,
      source: TimeEntrySource,
      db: Tx | PrismaClient = prisma,
    ) => db.timeEntry.create({ data: { userId, ...data, source }, include: entryInclude }),

    update: (
      id: string,
      data: Partial<EntryData> & { source?: TimeEntrySource },
      db: Tx | PrismaClient = prisma,
    ) => db.timeEntry.update({ where: { id }, data, include: entryInclude }),

    delete: (id: string, db: Tx | PrismaClient = prisma) => db.timeEntry.delete({ where: { id } }),

    // ─── what the user may track on ──────────────────────────────────────────
    findMembership: (projectId: string, userId: string) =>
      prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        include: { project: true },
      }),

    findTask: (projectId: string, taskId: string) =>
      prisma.task.findFirst({ where: { id: taskId, projectId } }),

    findUser: (id: string) => prisma.user.findUnique({ where: { id } }),

    /** Project ids where `userId` is the PM. */
    async managedProjectIds(userId: string): Promise<string[]> {
      const rows = await prisma.projectMember.findMany({
        where: { userId, roleInProject: 'PM' },
        select: { projectId: true },
      });
      return rows.map((r) => r.projectId);
    },

    isMemberOfAny: async (userId: string, projectIds: string[]) =>
      (await prisma.projectMember.count({ where: { userId, projectId: { in: projectIds } } })) > 0,

    /** Week starts (YYYY-MM-DD) in [from, to] of the user's submitted or approved timesheets. */
    async lockingWeekStarts(userId: string, from: string, to: string): Promise<string[]> {
      const rows = await prisma.timesheet.findMany({
        where: {
          userId,
          weekStart: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
          status: { in: ['SUBMITTED', 'APPROVED'] },
        },
        select: { weekStart: true },
      });
      return rows.map((r) => r.weekStart.toISOString().slice(0, 10));
    },

    /**
     * Stops every timer running longer than `maxSeconds` at exactly start + max, in one
     * statement (safe with several api instances). Returns what was stopped.
     */
    autoStop: (now: Date, maxSeconds: number) =>
      prisma.$queryRaw<
        { id: string; user_id: string; project_id: string; started_at: Date; ended_at: Date }[]
      >`
        UPDATE time_entries
        SET ended_at = started_at + make_interval(secs => ${maxSeconds}),
            source = 'AUTO_STOPPED'::time_entry_source,
            updated_at = ${now}
        WHERE ended_at IS NULL
          AND started_at <= ${now}::timestamptz - make_interval(secs => ${maxSeconds})
        RETURNING id, user_id, project_id, started_at, ended_at`,
  };
}

export type TimeEntriesRepository = ReturnType<typeof createTimeEntriesRepository>;
