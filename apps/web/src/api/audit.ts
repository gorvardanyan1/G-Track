import { auditLogResponseSchema, pageSchema } from '@tempo/shared';
import { z } from 'zod';
import { http } from './client.ts';

export interface AuditListParams {
  actorId?: string;
  /** Exact action names, or prefixes ending in "." */
  action?: string[];
  targetType?: string;
  targetId?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

/** Super Admin only. */
export const auditApi = {
  list: (p: AuditListParams = {}) =>
    http.request('/audit-logs', pageSchema(auditLogResponseSchema), {
      query: {
        actorId: p.actorId,
        action: p.action?.length ? p.action : undefined,
        targetType: p.targetType,
        targetId: p.targetId,
        from: p.from,
        to: p.to,
        page: p.page ? String(p.page) : undefined,
        pageSize: p.pageSize ? String(p.pageSize) : undefined,
      },
    }),
  actions: () => http.request('/audit-logs/actions', z.array(z.string())),
};
