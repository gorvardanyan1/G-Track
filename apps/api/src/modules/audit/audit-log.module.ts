import { Router, type RequestHandler } from 'express';
import { listAuditLogsQuerySchema, UserRole } from '@tempo/shared';
import type { PrismaClient } from '../../db/prisma.ts';
import { requireRole } from '../../middleware/require-role.ts';
import { validateQuery } from '../../middleware/validate.ts';
import { createAuditLogController } from './audit-log.controller.ts';
import { createAuditLogService } from './audit-log.service.ts';
import { createAuditRepository } from './audit.repository.ts';

/** /audit-logs: Super Admin only; other roles get 404. */
export function createAuditLogModule(deps: {
  prisma: PrismaClient;
  authenticate: RequestHandler;
}): Router {
  const controller = createAuditLogController(
    createAuditLogService(createAuditRepository(deps.prisma)),
  );
  const router = Router();
  router.use(deps.authenticate, requireRole(UserRole.SUPER_ADMIN));
  router.get('/', validateQuery(listAuditLogsQuerySchema), controller.list);
  router.get('/actions', controller.actions);
  return router;
}
