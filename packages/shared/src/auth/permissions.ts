import { UserRole } from './roles.ts';

export type ProjectRole = 'PM' | 'WORKER';
export const PROJECT_ROLES = ['PM', 'WORKER'] as const satisfies readonly ProjectRole[];

/**
 * How a user relates to a project. Super Admins see everything; a PM manages only projects
 * where they are the PM (and still hold the PM role); everyone else sees projects they are
 * assigned to. null = not visible (the api answers 404).
 */
export type ProjectAccess = 'admin' | 'manager' | 'member';

export function resolveProjectAccess(
  role: UserRole,
  membershipRole: ProjectRole | null,
): ProjectAccess | null {
  if (role === UserRole.SUPER_ADMIN) return 'admin';
  if (membershipRole === null) return null;
  if (membershipRole === 'PM' && role === UserRole.PROJECT_MANAGER) return 'manager';
  return 'member';
}

/** The same rules the api enforces; the web app uses them only to hide UI. */
export const projectPermissions = {
  editDetails: (access: ProjectAccess) => access === 'admin',
  archive: (access: ProjectAccess) => access === 'admin',
  editBudget: (access: ProjectAccess) => access !== 'member',
  viewMembersAndRates: (access: ProjectAccess) => access !== 'member',
  manageWorkers: (access: ProjectAccess) => access !== 'member',
  managePms: (access: ProjectAccess) => access === 'admin',
  manageTasks: (access: ProjectAccess) => access !== 'member',
} as const;
