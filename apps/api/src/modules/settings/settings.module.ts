import { Router, type RequestHandler } from 'express';
import { updateOrgSettingsRequestSchema, UserRole } from '@tempo/shared';
import type { PrismaClient } from '../../db/prisma.ts';
import type { Clock } from '../../lib/clock.ts';
import { requireRole } from '../../middleware/require-role.ts';
import { validateBody } from '../../middleware/validate.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { createSettingsController } from './settings.controller.ts';
import { createSettingsRepository } from './settings.repository.ts';
import { createSettingsService } from './settings.service.ts';

/** /settings: Super Admin only; other roles get 404. */
export function createSettingsModule(deps: {
  prisma: PrismaClient;
  audit: AuditService;
  clock: Clock;
  authenticate: RequestHandler;
}): Router {
  const controller = createSettingsController(
    createSettingsService({
      settings: createSettingsRepository(deps.prisma),
      audit: deps.audit,
      clock: deps.clock,
    }),
  );
  const router = Router();
  router.use(deps.authenticate, requireRole(UserRole.SUPER_ADMIN));
  router.get('/', controller.get);
  router.patch('/', validateBody(updateOrgSettingsRequestSchema), controller.update);
  return router;
}
