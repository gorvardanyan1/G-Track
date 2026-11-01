import type { PrismaClient } from '../../db/prisma.ts';
import type { Prisma } from '../../generated/prisma/client.ts';

export interface EntryFilter {
  start: Date;
  end: Date;
  userIds?: string[];
  projectIds?: string[];
  taskIds?: string[];
  clientIds?: string[];
  billable?: boolean;
}

const include = {
  user: { select: { id: true, name: true } },
  project: { select: { id: true, name: true, color: true, client: { select: { name: true } } } },
  task: { select: { id: true, name: true } },
} satisfies Prisma.TimeEntryInclude;

export type ReportEntryRow = Prisma.TimeEntryGetPayload<{ include: typeof include }>;

export function createReportsRepository(prisma: PrismaClient) {
  return {
    /** Completed entries overlapping [start, end); running timers are not reported. */
    findEntries: (f: EntryFilter) =>
      prisma.timeEntry.findMany({
        where: {
          endedAt: { not: null, gt: f.start },
          startedAt: { lt: f.end },
          ...(f.userIds && { userId: { in: f.userIds } }),
          ...(f.projectIds && { projectId: { in: f.projectIds } }),
          ...(f.taskIds && { taskId: { in: f.taskIds } }),
          ...(f.clientIds && { project: { clientId: { in: f.clientIds } } }),
          ...(f.billable !== undefined && { isBillable: f.billable }),
        },
        include,
        orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      }),

    /** Hourly rates per (project, user) for the given projects. */
    rates: (projectIds: string[]) =>
      prisma.projectMember.findMany({
        where: { projectId: { in: projectIds }, hourlyRate: { not: null } },
        select: { projectId: true, userId: true, hourlyRate: true },
      }),

    findViewer: (id: string) =>
      prisma.user.findUnique({ where: { id }, select: { id: true, timezone: true } }),

    /** Projects the user belongs to, as PM (`pmOnly`) or in any role. */
    memberProjects: (userId: string, pmOnly: boolean) =>
      prisma.project.findMany({
        where: {
          members: { some: { userId, ...(pmOnly && { roleInProject: 'PM' as const }) } },
        },
        select: { id: true, clientId: true },
      }),

    existingIds: async (kind: 'project' | 'task' | 'client' | 'user', ids: string[]) => {
      const where = { where: { id: { in: ids } }, select: { id: true } };
      const rows =
        kind === 'project'
          ? await prisma.project.findMany(where)
          : kind === 'task'
            ? await prisma.task.findMany(where)
            : kind === 'client'
              ? await prisma.client.findMany(where)
              : await prisma.user.findMany(where);
      return new Set(rows.map((r) => r.id));
    },

    taskProjects: (taskIds: string[]) =>
      prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: { id: true, projectId: true },
      }),

    memberUserIds: async (projectIds: string[]) =>
      new Set(
        (
          await prisma.projectMember.findMany({
            where: { projectId: { in: projectIds } },
            select: { userId: true },
          })
        ).map((m) => m.userId),
      ),

    /** Projects (with client and tasks) for the report filters; null = all. */
    optionProjects: (ids: string[] | null) =>
      prisma.project.findMany({
        where: ids ? { id: { in: ids } } : {},
        include: { client: true, tasks: { orderBy: [{ name: 'asc' }, { id: 'asc' }] } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),

    optionUsers: (ids: string[] | null) =>
      prisma.user.findMany({
        where: ids ? { id: { in: ids } } : {},
        select: { id: true, name: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
  };
}

export type ReportsRepository = ReturnType<typeof createReportsRepository>;
