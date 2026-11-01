import { Router, type RequestHandler } from 'express';
import {
  approveTimesheetRequestSchema,
  idParamsSchema,
  listTimesheetsQuerySchema,
  rejectTimesheetRequestSchema,
  submitTimesheetRequestSchema,
  timesheetWeekQuerySchema,
} from '@tempo/shared';
import type { PrismaClient } from '../../db/prisma.ts';
import type { Clock } from '../../lib/clock.ts';
import type { EventBus } from '../../lib/event-bus.ts';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { createSettingsRepository } from '../settings/settings.repository.ts';
import { createTimesheetsController } from './timesheets.controller.ts';
import { createTimesheetsRepository } from './timesheets.repository.ts';
import { createTimesheetsService } from './timesheets.service.ts';

/** /timesheets: everyone authenticated; visibility and review rights live in the service. */
export function createTimesheetsModule(deps: {
  prisma: PrismaClient;
  audit: AuditService;
  clock: Clock;
  authenticate: RequestHandler;
  events: EventBus;
}): Router {
  const controller = createTimesheetsController(
    createTimesheetsService({
      timesheets: createTimesheetsRepository(deps.prisma),
      settings: createSettingsRepository(deps.prisma),
      audit: deps.audit,
      clock: deps.clock,
      events: deps.events,
    }),
  );
  const router = Router();
  const byId = validateParams(idParamsSchema);
  router.use(deps.authenticate);
  router.get('/', validateQuery(listTimesheetsQuerySchema), controller.list);
  router.get('/me', validateQuery(timesheetWeekQuerySchema), controller.mine);
  router.post('/submit', validateBody(submitTimesheetRequestSchema), controller.submit);
  router.get('/:id', byId, controller.get);
  router.post(
    '/:id/approve',
    byId,
    validateBody(approveTimesheetRequestSchema),
    controller.approve,
  );
  router.post('/:id/reject', byId, validateBody(rejectTimesheetRequestSchema), controller.reject);
  return router;
}
