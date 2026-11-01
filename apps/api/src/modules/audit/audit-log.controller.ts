import type { RequestHandler } from 'express';
import type { AuditLogResponse, ListAuditLogsQuery, Page } from '@tempo/shared';
import { validatedQuery } from '../../middleware/validate.ts';
import { requireAuth } from '../auth/auth.http.ts';
import { AuditAction } from './audit-actions.ts';
import type { AuditLogService } from './audit-log.service.ts';

type AuditRow = Awaited<ReturnType<AuditLogService['list']>>['items'][number];

const toResponse = (row: AuditRow): AuditLogResponse => ({
  id: row.id,
  createdAt: row.createdAt.toISOString(),
  action: row.action,
  actor: row.actor,
  targetType: row.targetType,
  targetId: row.targetId,
  before: row.before,
  after: row.after,
  ip: row.ip,
  userAgent: row.userAgent,
  requestId: row.requestId,
});

export function createAuditLogController(auditLog: AuditLogService) {
  const list: RequestHandler = async (req, res) => {
    const query = validatedQuery<ListAuditLogsQuery>(req);
    const { items, total } = await auditLog.list(requireAuth(req), query);
    const body: Page<AuditLogResponse> = {
      items: items.map(toResponse),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
    res.json(body);
  };

  /** Known action names, for the filter dropdown. */
  const actions: RequestHandler = (_req, res) => {
    res.json(Object.values(AuditAction).sort());
  };

  return { list, actions };
}
