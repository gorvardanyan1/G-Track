import type { PrismaClient } from '../../db/prisma.ts';
import type { Prisma, ProjectRole, UserRole } from '../../generated/prisma/client.ts';

/** Includes the requesting user's own membership, which decides their access level. */
const withAccess = (userId: string) =>
  ({ client: true, members: { where: { userId } } }) satisfies Prisma.ProjectInclude;

export type ProjectWithAccess = Prisma.ProjectGetPayload<{
  include: ReturnType<typeof withAccess>;
}>;

export function createProjectsRepository(prisma: PrismaClient) {
  return {
    /** Visibility is a query filter: admins see all, everyone else only projects they belong to. */
    listVisible: (userId: string, isAdmin: boolean, includeArchived: boolean) =>
      prisma.project.findMany({
        where: {
          ...(isAdmin ? {} : { members: { some: { userId } } }),
          ...(includeArchived ? {} : { archivedAt: null }),
        },
        include: withAccess(userId),
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),

    findWithAccess: (projectId: string, userId: string) =>
      prisma.project.findUnique({ where: { id: projectId }, include: withAccess(userId) }),

    create: (data: Prisma.ProjectUncheckedCreateInput, userId: string) =>
      prisma.project.create({ data, include: withAccess(userId) }),

    update: (projectId: string, data: Prisma.ProjectUncheckedUpdateInput, userId: string) =>
      prisma.project.update({ where: { id: projectId }, data, include: withAccess(userId) }),

    findClient: (id: string) => prisma.client.findUnique({ where: { id } }),

    // ─── members ─────────────────────────────────────────────────────────────
    listMembers: (projectId: string) =>
      prisma.projectMember.findMany({
        where: { projectId },
        include: { user: true },
        orderBy: [{ roleInProject: 'asc' }, { user: { name: 'asc' } }],
      }),

    findMember: (projectId: string, userId: string) =>
      prisma.projectMember.findUnique({
        where: { projectId_userId: { projectId, userId } },
        include: { user: true },
      }),

    upsertMember: (
      projectId: string,
      userId: string,
      roleInProject: ProjectRole,
      hourlyRate: number | null,
    ) =>
      prisma.projectMember.upsert({
        where: { projectId_userId: { projectId, userId } },
        create: { projectId, userId, roleInProject, hourlyRate },
        update: { roleInProject, hourlyRate },
        include: { user: true },
      }),

    deleteMember: (projectId: string, userId: string) =>
      prisma.projectMember.delete({ where: { projectId_userId: { projectId, userId } } }),

    findUser: (id: string) => prisma.user.findUnique({ where: { id } }),

    /** Active users with one of `roles` who are not yet on the project. */
    memberCandidates: (projectId: string, roles: UserRole[]) =>
      prisma.user.findMany({
        where: { isActive: true, role: { in: roles }, memberships: { none: { projectId } } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),

    // ─── tasks ───────────────────────────────────────────────────────────────
    listTasks: (projectId: string) =>
      prisma.task.findMany({ where: { projectId }, orderBy: [{ isDone: 'asc' }, { name: 'asc' }] }),

    findTask: (projectId: string, taskId: string) =>
      prisma.task.findFirst({ where: { id: taskId, projectId } }),

    createTask: (projectId: string, name: string) =>
      prisma.task.create({ data: { projectId, name } }),

    updateTask: (taskId: string, data: { name?: string; isDone?: boolean }) =>
      prisma.task.update({ where: { id: taskId }, data }),

    deleteTask: (taskId: string) => prisma.task.delete({ where: { id: taskId } }),
  };
}

export type ProjectsRepository = ReturnType<typeof createProjectsRepository>;
