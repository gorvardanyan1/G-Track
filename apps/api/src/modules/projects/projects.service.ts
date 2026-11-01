import {
  projectPermissions,
  type CreateProjectRequest,
  type UpdateProjectRequest,
} from '@tempo/shared';
import { BadRequestError, ConflictError } from '../../errors/app-error.ts';
import type { Clock } from '../../lib/clock.ts';
import { isUniqueViolation } from '../../lib/prisma-errors.ts';
import type { RequestContext } from '../../lib/request-context.ts';
import { AuditAction } from '../audit/audit-actions.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { AuthContext } from '../auth/auth.types.ts';
import {
  accessOf,
  assertAllowed,
  assertNotArchived,
  loadVisibleProject,
  type VisibleProject,
} from './project-access.ts';
import type { ProjectsRepository, ProjectWithAccess } from './projects.repository.ts';

interface Deps {
  projects: ProjectsRepository;
  audit: AuditService;
  clock: Clock;
}

const duplicateName = () => new ConflictError('This client already has a project with this name');

/** Fields only a Super Admin may change; a PM may change only the budget. */
const ADMIN_ONLY_FIELDS = ['clientId', 'name', 'color', 'isBillable'] as const;

function snapshot(project: ProjectWithAccess) {
  return {
    clientId: project.clientId,
    name: project.name,
    color: project.color,
    budgetHours: project.budgetHours === null ? null : Number(project.budgetHours),
    isBillable: project.isBillable,
  };
}

export function createProjectsService({ projects, audit, clock }: Deps) {
  async function assertUsableClient(clientId: string | null | undefined) {
    if (!clientId) return;
    const client = await projects.findClient(clientId);
    if (!client || client.archivedAt) throw new BadRequestError('Client not found or archived');
  }

  return {
    async list(auth: AuthContext, includeArchived: boolean): Promise<VisibleProject[]> {
      const rows = await projects.listVisible(
        auth.userId,
        auth.role === 'SUPER_ADMIN',
        includeArchived,
      );
      return rows.flatMap((project) => {
        const access = accessOf(auth, project);
        return access ? [{ project, access }] : [];
      });
    },

    get: (auth: AuthContext, projectId: string) => loadVisibleProject(projects, auth, projectId),

    /** Super Admin only (route). */
    async create(
      auth: AuthContext,
      input: CreateProjectRequest,
      context: RequestContext,
    ): Promise<VisibleProject> {
      await assertUsableClient(input.clientId);
      try {
        const project = await projects.create(input, auth.userId);
        await audit.record(
          AuditAction.PROJECT_CREATED,
          {
            actorId: auth.userId,
            targetType: 'project',
            targetId: project.id,
            after: snapshot(project),
          },
          context,
        );
        return { project, access: 'admin' };
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicateName();
        throw err;
      }
    },

    async update(
      auth: AuthContext,
      projectId: string,
      input: UpdateProjectRequest,
      context: RequestContext,
    ): Promise<VisibleProject> {
      const { project, access } = await loadVisibleProject(projects, auth, projectId);
      assertAllowed(projectPermissions.editBudget(access), 'You cannot edit this project');
      if (
        !projectPermissions.editDetails(access) &&
        ADMIN_ONLY_FIELDS.some((field) => input[field] !== undefined)
      ) {
        assertAllowed(false, 'Project managers can only change the budget');
      }
      assertNotArchived(project);
      await assertUsableClient(input.clientId);

      try {
        const updated = await projects.update(projectId, input, auth.userId);
        await audit.record(
          AuditAction.PROJECT_UPDATED,
          {
            actorId: auth.userId,
            targetType: 'project',
            targetId: projectId,
            before: snapshot(project),
            after: snapshot(updated),
          },
          context,
        );
        return { project: updated, access };
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicateName();
        throw err;
      }
    },

    /** Super Admin only (route). */
    async setArchived(
      auth: AuthContext,
      projectId: string,
      archived: boolean,
      context: RequestContext,
    ): Promise<VisibleProject> {
      const { project, access } = await loadVisibleProject(projects, auth, projectId);
      assertAllowed(projectPermissions.archive(access), 'You cannot archive this project');
      if ((project.archivedAt !== null) === archived) return { project, access };
      const updated = await projects.update(
        projectId,
        { archivedAt: archived ? clock() : null },
        auth.userId,
      );
      await audit.record(
        archived ? AuditAction.PROJECT_ARCHIVED : AuditAction.PROJECT_UNARCHIVED,
        { actorId: auth.userId, targetType: 'project', targetId: projectId },
        context,
      );
      return { project: updated, access };
    },
  };
}

export type ProjectsService = ReturnType<typeof createProjectsService>;
