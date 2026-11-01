import { resolveProjectAccess, type ProjectAccess } from '@tempo/shared';
import { ConflictError, ForbiddenError, NotFoundError } from '../../errors/app-error.ts';
import type { AuthContext } from '../auth/auth.types.ts';
import type { ProjectsRepository, ProjectWithAccess } from './projects.repository.ts';

export interface VisibleProject {
  project: ProjectWithAccess;
  access: ProjectAccess;
}

export function accessOf(auth: AuthContext, project: ProjectWithAccess): ProjectAccess | null {
  return resolveProjectAccess(auth.role, project.members[0]?.roleInProject ?? null);
}

/** Loads a project the caller may see. Invisible and non-existent projects look the same: 404. */
export async function loadVisibleProject(
  projects: ProjectsRepository,
  auth: AuthContext,
  projectId: string,
): Promise<VisibleProject> {
  const project = await projects.findWithAccess(projectId, auth.userId);
  const access = project ? accessOf(auth, project) : null;
  if (!project || !access) throw new NotFoundError('Project not found');
  return { project, access };
}

/** For callers who can see the project but lack a permission: 403 (they know it exists). */
export function assertAllowed(allowed: boolean, message: string): void {
  if (!allowed) throw new ForbiddenError(message);
}

export function assertNotArchived(project: { archivedAt: Date | null }): void {
  if (project.archivedAt !== null) throw new ConflictError('Project is archived');
}
