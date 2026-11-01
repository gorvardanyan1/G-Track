import { UserRole, type ReportQuery } from '@tempo/shared';
import { NotFoundError } from '../../errors/app-error.ts';
import type { AuthContext } from '../auth/auth.types.ts';
import type { EntryFilter, ReportsRepository } from './reports.repository.ts';

export interface ReportScope {
  filter: Omit<EntryFilter, 'start' | 'end'>;
  /** Rates and amounts are for admins and PMs only. */
  showAmounts: boolean;
}

const notFound = (what: string) => new NotFoundError(`${what} not found`);
const allIn = (ids: string[] | undefined, allowed: ReadonlySet<string | null>) =>
  (ids ?? []).every((id) => allowed.has(id));

/**
 * Which entries the caller may report on, with every id filter checked against it (an id the
 * caller can't see is a 404, like everywhere else):
 *   Super Admin — everything; PM — entries on projects they manage; worker — their own entries.
 */
export async function resolveReportScope(
  reports: ReportsRepository,
  auth: AuthContext,
  query: ReportQuery,
): Promise<ReportScope> {
  const { projectId, taskId, clientId, userId } = query;
  const base = {
    ...(projectId && { projectIds: projectId }),
    ...(taskId && { taskIds: taskId }),
    ...(clientId && { clientIds: clientId }),
    ...(userId && { userIds: userId }),
  };

  if (auth.role === UserRole.SUPER_ADMIN) {
    const checks = [
      ['project', projectId],
      ['task', taskId],
      ['client', clientId],
      ['user', userId],
    ] as const;
    for (const [kind, ids] of checks) {
      if (ids?.length && !allIn(ids, await reports.existingIds(kind, ids)))
        throw notFound(kind[0]?.toUpperCase() + kind.slice(1));
    }
    return { filter: base, showAmounts: true };
  }

  const isPm = auth.role === UserRole.PROJECT_MANAGER;
  const projects = await reports.memberProjects(auth.userId, isPm);
  const projectIds = new Set(projects.map((p) => p.id));
  if (!allIn(projectId, projectIds)) throw notFound('Project');
  if (taskId?.length) {
    const tasks = await reports.taskProjects(taskId);
    if (tasks.length !== new Set(taskId).size || !tasks.every((t) => projectIds.has(t.projectId)))
      throw notFound('Task');
  }
  if (!allIn(clientId, new Set(projects.map((p) => p.clientId)))) throw notFound('Client');

  if (isPm) {
    const people = await reports.memberUserIds([...projectIds]);
    if (!allIn(userId, people.add(auth.userId))) throw notFound('User');
    return { filter: { ...base, projectIds: projectId ?? [...projectIds] }, showAmounts: true };
  }
  if (!allIn(userId, new Set([auth.userId]))) throw notFound('User');
  return { filter: { ...base, userIds: [auth.userId] }, showAmounts: false };
}
