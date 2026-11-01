import { addDays, startOfLocalDay, type ListAuditLogsQuery } from '@tempo/shared';
import { NotFoundError } from '../../errors/app-error.ts';
import type { AuthContext } from '../auth/auth.types.ts';
import type { AuditRepository } from './audit.repository.ts';

/** Reading the audit log (Super Admin only, enforced by the route). */
export function createAuditLogService(audit: AuditRepository) {
  return {
    /** Date filters are local days in the viewer's timezone. */
    async list(auth: AuthContext, query: ListAuditLogsQuery) {
      const zone = await audit.viewerTimezone(auth.userId);
      if (!zone) throw new NotFoundError('User not found');
      return audit.list(
        {
          ...(query.actorId && { actorId: query.actorId }),
          ...(query.action && { actions: query.action }),
          ...(query.targetType && { targetType: query.targetType }),
          ...(query.targetId && { targetId: query.targetId }),
          ...(query.from && { from: startOfLocalDay(query.from, zone) }),
          ...(query.to && { to: startOfLocalDay(addDays(query.to, 1), zone) }),
        },
        query.page,
        query.pageSize,
      );
    },
  };
}

export type AuditLogService = ReturnType<typeof createAuditLogService>;
