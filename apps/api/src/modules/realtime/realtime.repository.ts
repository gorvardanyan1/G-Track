import type { PrismaClient } from '../../db/prisma.ts';
import { entryInclude } from '../time-entries/time-entries.repository.ts';

const withUser = { ...entryInclude, user: { select: { id: true, name: true } } } as const;

export function createRealtimeRepository(prisma: PrismaClient) {
  return {
    findUser: (id: string) =>
      prisma.user.findUnique({
        where: { id },
        select: { id: true, name: true, role: true, isActive: true, timezone: true },
      }),

    /** Projects where the user is the PM (the caller checks the global role). */
    async managedProjectIds(userId: string): Promise<string[]> {
      const rows = await prisma.projectMember.findMany({
        where: { userId, roleInProject: 'PM' },
        select: { projectId: true },
      });
      return rows.map((r) => r.projectId);
    },

    findEntry: (id: string) =>
      prisma.timeEntry.findUnique({ where: { id }, include: entryInclude }),

    findRunning: (userId: string) =>
      prisma.timeEntry.findFirst({ where: { userId, endedAt: null }, include: entryInclude }),

    /** Running timers, on the given projects or everywhere (null). */
    runningOn: (projectIds: string[] | null) =>
      prisma.timeEntry.findMany({
        where: { endedAt: null, ...(projectIds && { projectId: { in: projectIds } }) },
        include: withUser,
        orderBy: { startedAt: 'asc' },
      }),

    findTimesheet: (id: string) =>
      prisma.timesheet.findUnique({
        where: { id },
        select: { id: true, userId: true, weekStart: true, status: true },
      }),
  };
}

export type RealtimeRepository = ReturnType<typeof createRealtimeRepository>;
