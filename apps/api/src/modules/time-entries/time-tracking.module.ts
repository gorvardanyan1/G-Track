import { Router, type RequestHandler } from 'express';
import {
  createTimeEntryRequestSchema,
  duplicateTimeEntryRequestSchema,
  idParamsSchema,
  listTimeEntriesQuerySchema,
  startTimerRequestSchema,
  updateTimeEntryRequestSchema,
} from '@tempo/shared';
import type { PrismaClient } from '../../db/prisma.ts';
import type { Clock } from '../../lib/clock.ts';
import type { EventBus } from '../../lib/event-bus.ts';
import type { RateLimiter } from '../../middleware/rate-limit.ts';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { createSettingsRepository } from '../settings/settings.repository.ts';
import { createTimerController } from '../timer/timer.controller.ts';
import { createTimerService } from '../timer/timer.service.ts';
import { createEntryPolicy } from './entry-policy.ts';
import { createTimeEntriesController } from './time-entries.controller.ts';
import { createTimeEntriesRepository } from './time-entries.repository.ts';
import { createTimeEntriesService } from './time-entries.service.ts';

interface Deps {
  prisma: PrismaClient;
  audit: AuditService;
  clock: Clock;
  authenticate: RequestHandler;
  rateLimit: RateLimiter;
  events: EventBus;
}

/** Timer (/timer) and time entries (/time-entries) share the entry policy and repository. */
export function createTimeTrackingModule({
  prisma,
  audit,
  clock,
  authenticate,
  rateLimit,
  events,
}: Deps) {
  const entries = createTimeEntriesRepository(prisma);
  const policy = createEntryPolicy({ entries, settings: createSettingsRepository(prisma), clock });
  const entriesService = createTimeEntriesService({ entries, policy, audit, clock, events });
  const timer = createTimerController(
    createTimerService({ entries, policy, clock, events }),
    entriesService,
    clock,
  );
  const controller = createTimeEntriesController(entriesService);
  const byUser = (req: { auth?: { userId: string } }) => req.auth?.userId ?? null;

  const timerRouter = Router();
  timerRouter.use(authenticate);
  timerRouter.get('/', timer.current);
  timerRouter.post(
    '/start',
    rateLimit({ name: 'timer-start', windowMs: 60_000, max: 60, key: byUser }),
    validateBody(startTimerRequestSchema),
    timer.start,
  );
  timerRouter.post('/stop', timer.stop);

  const entriesRouter = Router();
  const byId = validateParams(idParamsSchema);
  entriesRouter.use(authenticate);
  entriesRouter.get('/', validateQuery(listTimeEntriesQuerySchema), controller.list);
  entriesRouter.post('/', validateBody(createTimeEntryRequestSchema), controller.create);
  entriesRouter.get('/:id', byId, controller.get);
  entriesRouter.patch('/:id', byId, validateBody(updateTimeEntryRequestSchema), controller.update);
  entriesRouter.delete('/:id', byId, controller.remove);
  entriesRouter.post(
    '/:id/duplicate',
    byId,
    validateBody(duplicateTimeEntryRequestSchema),
    controller.duplicate,
  );

  return { timerRouter, entriesRouter };
}
