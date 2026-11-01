import {
  projectPermissions,
  todayInZone,
  weekRange,
  type ProjectUsage,
  type ProjectUsageDetailResponse,
  type ProjectUsageListResponse,
} from '@tempo/shared';
import { NotFoundError } from '../../errors/app-error.ts';
import type { Clock } from '../../lib/clock.ts';
import type { AuthContext } from '../auth/auth.types.ts';
import type { SettingsRepository } from '../settings/settings.repository.ts';
import { accessOf, assertAllowed, loadVisibleProject } from './project-access.ts';
import type { ProjectUsageRepository, UsageRow } from './project-usage.repository.ts';
import type { ProjectsRepository, ProjectWithAccess } from './projects.repository.ts';

interface Deps {
  projects: ProjectsRepository;
  usage: ProjectUsageRepository;
  settings: SettingsRepository;
  clock: Clock;
}

const sum = (rows: UsageRow[]) => ({
  totalSeconds: rows.reduce((a, r) => a + r.totalSeconds, 0),
  weekSeconds: rows.reduce((a, r) => a + r.weekSeconds, 0),
});

const usageOf = (project: ProjectWithAccess, rows: UsageRow[]): ProjectUsage => ({
  project: {
    id: project.id,
    name: project.name,
    color: project.color,
    clientName: project.client?.name ?? null,
  },
  budgetHours: project.budgetHours === null ? null : Number(project.budgetHours),
  ...sum(rows),
});

/** Budget usage for the people who manage a project: its Super Admins and its PM. */
export function createProjectUsageService({ projects, usage, settings, clock }: Deps) {
  /** The viewer's current week (organization's week start, viewer's timezone). */
  async function currentWeek(auth: AuthContext) {
    const viewer = await usage.findViewer(auth.userId);
    if (!viewer) throw new NotFoundError('User not found');
    const { weekStartDay } = await settings.getPolicy();
    const now = clock();
    const range = weekRange(todayInZone(viewer.timezone, now), viewer.timezone, weekStartDay);
    return { now, range, timezone: viewer.timezone };
  }

  return {
    async list(auth: AuthContext): Promise<ProjectUsageListResponse> {
      // Workers manage nothing; the list exists only for PMs and admins.
      if (auth.role === 'WORKER') throw new NotFoundError('Not found');
      const visible = await projects.listVisible(auth.userId, auth.role === 'SUPER_ADMIN', false);
      const managed = visible.filter((p) => {
        const access = accessOf(auth, p);
        return access !== null && projectPermissions.viewMembersAndRates(access);
      });
      const { now, range, timezone } = await currentWeek(auth);
      const rows = await usage.usage(
        managed.map((p) => p.id),
        range,
        now,
      );
      return {
        week: { from: range.firstDate, to: range.lastDate },
        timezone,
        items: managed.map((p) =>
          usageOf(
            p,
            rows.filter((r) => r.projectId === p.id),
          ),
        ),
      };
    },

    async get(auth: AuthContext, projectId: string): Promise<ProjectUsageDetailResponse> {
      const { project, access } = await loadVisibleProject(projects, auth, projectId);
      assertAllowed(
        projectPermissions.viewMembersAndRates(access),
        'You cannot view the budget of this project',
      );
      const { now, range, timezone } = await currentWeek(auth);
      const rows = await usage.usage([projectId], range, now);
      return {
        ...usageOf(project, rows),
        week: { from: range.firstDate, to: range.lastDate },
        timezone,
        byMember: rows.map((r) => ({
          user: { id: r.userId, name: r.userName },
          totalSeconds: r.totalSeconds,
          weekSeconds: r.weekSeconds,
        })),
      };
    },
  };
}

export type ProjectUsageService = ReturnType<typeof createProjectUsageService>;
