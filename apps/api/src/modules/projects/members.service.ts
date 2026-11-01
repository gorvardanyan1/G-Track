import { projectPermissions, UserRole, type UpsertMemberRequest } from '@tempo/shared';
import { BadRequestError, NotFoundError } from '../../errors/app-error.ts';
import type { EventBus } from '../../lib/event-bus.ts';
import type { RequestContext } from '../../lib/request-context.ts';
import { AuditAction } from '../audit/audit-actions.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { AuthContext } from '../auth/auth.types.ts';
import { assertAllowed, assertNotArchived, loadVisibleProject } from './project-access.ts';
import type { ProjectsRepository } from './projects.repository.ts';

interface Deps {
  projects: ProjectsRepository;
  audit: AuditService;
  events: EventBus;
}

const memberSnapshot = (member: { roleInProject: string; hourlyRate: unknown } | null) =>
  member && {
    roleInProject: member.roleInProject,
    hourlyRate: member.hourlyRate === null ? null : Number(member.hourlyRate),
  };

export function createMembersService({ projects, audit, events }: Deps) {
  async function loadForManagement(auth: AuthContext, projectId: string) {
    const visible = await loadVisibleProject(projects, auth, projectId);
    assertAllowed(
      projectPermissions.manageWorkers(visible.access),
      'You cannot manage members of this project',
    );
    return visible;
  }

  return {
    async list(auth: AuthContext, projectId: string) {
      const { access } = await loadVisibleProject(projects, auth, projectId);
      assertAllowed(
        projectPermissions.viewMembersAndRates(access),
        'You cannot view members of this project',
      );
      return projects.listMembers(projectId);
    },

    /** People the caller may add: PMs add workers; Super Admins add workers and PMs. */
    async candidates(auth: AuthContext, projectId: string) {
      const { access } = await loadForManagement(auth, projectId);
      const roles: UserRole[] = projectPermissions.managePms(access)
        ? [UserRole.WORKER, UserRole.PROJECT_MANAGER]
        : [UserRole.WORKER];
      return projects.memberCandidates(projectId, roles);
    },

    async upsert(
      auth: AuthContext,
      projectId: string,
      userId: string,
      input: UpsertMemberRequest,
      context: RequestContext,
    ) {
      const { project, access } = await loadForManagement(auth, projectId);
      assertNotArchived(project);

      const existing = await projects.findMember(projectId, userId);
      if (input.roleInProject === 'PM' || existing?.roleInProject === 'PM') {
        assertAllowed(
          projectPermissions.managePms(access),
          'Only Super Admins can assign project managers',
        );
      }
      const user = existing?.user ?? (await projects.findUser(userId));
      if (!user?.isActive) throw new NotFoundError('User not found');
      const requiredRole =
        input.roleInProject === 'PM' ? UserRole.PROJECT_MANAGER : UserRole.WORKER;
      if (user.role !== requiredRole) {
        throw new BadRequestError(
          input.roleInProject === 'PM'
            ? 'Only users with the Project Manager role can be a project’s PM'
            : 'Only users with the Worker role can be assigned as workers',
        );
      }

      const member = await projects.upsertMember(
        projectId,
        userId,
        input.roleInProject,
        input.hourlyRate,
      );
      await audit.record(
        existing ? AuditAction.MEMBER_UPDATED : AuditAction.MEMBER_ADDED,
        {
          actorId: auth.userId,
          targetType: 'project',
          targetId: projectId,
          ...(existing && { before: { userId, ...memberSnapshot(existing) } }),
          after: { userId, ...memberSnapshot(member) },
        },
        context,
      );
      events.publish({ type: 'access.changed', userId });
      return member;
    },

    async remove(auth: AuthContext, projectId: string, userId: string, context: RequestContext) {
      const { project, access } = await loadForManagement(auth, projectId);
      assertNotArchived(project);
      const member = await projects.findMember(projectId, userId);
      if (!member) throw new NotFoundError('Member not found');
      if (member.roleInProject === 'PM') {
        assertAllowed(
          projectPermissions.managePms(access),
          'Only Super Admins can remove project managers',
        );
      }
      await projects.deleteMember(projectId, userId);
      await audit.record(
        AuditAction.MEMBER_REMOVED,
        {
          actorId: auth.userId,
          targetType: 'project',
          targetId: projectId,
          before: { userId, ...memberSnapshot(member) },
        },
        context,
      );
      events.publish({ type: 'access.changed', userId });
    },
  };
}

export type MembersService = ReturnType<typeof createMembersService>;
