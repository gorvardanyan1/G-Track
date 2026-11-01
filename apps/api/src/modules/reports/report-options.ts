import { UserRole, type ReportOptionsResponse } from '@tempo/shared';
import type { AuthContext } from '../auth/auth.types.ts';
import type { ReportsRepository } from './reports.repository.ts';

/**
 * The filter choices for the caller, matching `resolveReportScope`: Super Admins get
 * everything, PMs the projects they manage and those projects' people, workers their own
 * projects and themselves.
 */
export async function reportOptions(
  reports: ReportsRepository,
  auth: AuthContext,
): Promise<ReportOptionsResponse> {
  let projectIds: string[] | null = null;
  let userIds: string[] | null = null;
  if (auth.role !== UserRole.SUPER_ADMIN) {
    const isPm = auth.role === UserRole.PROJECT_MANAGER;
    projectIds = (await reports.memberProjects(auth.userId, isPm)).map((p) => p.id);
    userIds = isPm
      ? [...(await reports.memberUserIds(projectIds)).add(auth.userId)]
      : [auth.userId];
  }
  const [projects, users] = await Promise.all([
    reports.optionProjects(projectIds),
    reports.optionUsers(userIds),
  ]);

  const clients = new Map<string, { id: string; name: string }>();
  for (const p of projects)
    if (p.client) clients.set(p.client.id, { id: p.client.id, name: p.client.name });
  return {
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color,
      clientId: p.clientId,
      archived: p.archivedAt !== null,
    })),
    tasks: projects.flatMap((p) =>
      p.tasks.map((t) => ({ id: t.id, projectId: p.id, name: t.name })),
    ),
    users,
    clients: [...clients.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
