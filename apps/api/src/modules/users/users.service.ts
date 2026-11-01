import type { ListUsersQuery, UserRole } from '@tempo/shared';
import { ConflictError, NotFoundError } from '../../errors/app-error.ts';
import type { Clock } from '../../lib/clock.ts';
import type { EventBus } from '../../lib/event-bus.ts';
import type { RequestContext } from '../../lib/request-context.ts';
import { AuditAction } from '../audit/audit-actions.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { AuthContext } from '../auth/auth.types.ts';
import type { SessionService } from '../auth/session.service.ts';
import type { UsersRepository } from './users.repository.ts';

interface Deps {
  users: UsersRepository;
  sessions: SessionService;
  audit: AuditService;
  clock: Clock;
  events: EventBus;
}

/** User administration. Every method assumes the route already required SUPER_ADMIN. */
export function createUsersService({ users, sessions, audit, clock, events }: Deps) {
  async function load(id: string) {
    const user = await users.findById(id);
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  /** The repository refuses (atomically) to leave the organization without an active Super Admin. */
  const lastSuperAdmin = (what: string) =>
    new ConflictError(`Cannot ${what} the last active Super Admin`);

  const record = (
    action: AuditAction,
    actor: AuthContext,
    targetId: string,
    context: RequestContext,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ) =>
    audit.record(
      action,
      {
        actorId: actor.userId,
        targetType: 'user',
        targetId,
        ...(before && { before }),
        ...(after && { after }),
      },
      context,
    );

  return {
    list: (query: ListUsersQuery) => users.list(query),
    get: load,

    async changeRole(actor: AuthContext, id: string, role: UserRole, context: RequestContext) {
      if (id === actor.userId) throw new ConflictError('You cannot change your own role');
      const user = await load(id);
      if (user.role === role) return user;
      const updated = await users.setRole(id, role);
      if (!updated) throw lastSuperAdmin('demote');
      await record(
        AuditAction.USER_ROLE_CHANGED,
        actor,
        id,
        context,
        { role: user.role },
        { role },
      );
      events.publish({ type: 'access.changed', userId: id });
      return updated;
    },

    async deactivate(actor: AuthContext, id: string, context: RequestContext) {
      if (id === actor.userId) throw new ConflictError('You cannot deactivate your own account');
      const user = await load(id);
      if (!user.isActive) return user;
      const result = await users.deactivate(id, clock());
      if (!result) throw lastSuperAdmin('deactivate');
      const { user: updated, stoppedTimer } = result;
      events.publish({ type: 'sessions.revoked', userId: id });
      if (stoppedTimer) {
        events.publish({
          type: 'entry.saved',
          userId: id,
          entryId: stoppedTimer.id,
          action: 'timer_stopped',
          projectIds: [stoppedTimer.project_id],
        });
      }
      await record(
        AuditAction.USER_DEACTIVATED,
        actor,
        id,
        context,
        { isActive: true },
        { isActive: false },
      );
      return updated;
    },

    async activate(actor: AuthContext, id: string, context: RequestContext) {
      const user = await load(id);
      if (user.isActive) return user;
      const updated = await users.activate(id);
      await record(
        AuditAction.USER_ACTIVATED,
        actor,
        id,
        context,
        { isActive: false },
        { isActive: true },
      );
      return updated;
    },

    async revokeSessions(actor: AuthContext, id: string, context: RequestContext) {
      await load(id);
      const { count } = await sessions.revokeAllForUser(id);
      await record(AuditAction.USER_SESSIONS_REVOKED, actor, id, context, undefined, {
        sessionsRevoked: count,
      });
    },

    listPendingInvites: () => users.listPendingInvites(clock()),

    async revokeInvite(actor: AuthContext, id: string, context: RequestContext) {
      const invite = await users.findPendingInvite(id, clock());
      if (!invite) throw new NotFoundError('Invite not found');
      await users.revokeInvite(id, clock());
      await audit.record(
        AuditAction.INVITE_REVOKED,
        {
          actorId: actor.userId,
          targetType: 'invite',
          targetId: id,
          before: { email: invite.email, role: invite.role },
        },
        context,
      );
    },
  };
}

export type UsersService = ReturnType<typeof createUsersService>;
