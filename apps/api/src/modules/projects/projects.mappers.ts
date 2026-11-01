import {
  projectPermissions,
  type MemberCandidateResponse,
  type MemberResponse,
  type ProjectResponse,
  type TaskResponse,
} from '@tempo/shared';
import type { Prisma, Task, User } from '../../generated/prisma/client.ts';
import type { VisibleProject } from './project-access.ts';

const decimalToNumber = (value: Prisma.Decimal | null) => (value === null ? null : Number(value));

/** Budget is only included for callers allowed to see it (admins and the project's PM). */
export function toProjectResponse({ project, access }: VisibleProject): ProjectResponse {
  return {
    id: project.id,
    name: project.name,
    color: project.color,
    isBillable: project.isBillable,
    archivedAt: project.archivedAt?.toISOString() ?? null,
    client: project.client && { id: project.client.id, name: project.client.name },
    access,
    ...(projectPermissions.viewMembersAndRates(access) && {
      budgetHours: decimalToNumber(project.budgetHours),
    }),
  };
}

export const toMemberResponse = (
  member: Prisma.ProjectMemberGetPayload<{ include: { user: true } }>,
): MemberResponse => ({
  userId: member.userId,
  name: member.user.name,
  email: member.user.email,
  role: member.user.role,
  roleInProject: member.roleInProject,
  hourlyRate: decimalToNumber(member.hourlyRate),
});

export const toCandidateResponse = (user: User): MemberCandidateResponse => ({
  id: user.id,
  name: user.name,
  email: user.email,
  role: user.role,
});

export const toTaskResponse = (task: Task): TaskResponse => ({
  id: task.id,
  projectId: task.projectId,
  name: task.name,
  isDone: task.isDone,
});
