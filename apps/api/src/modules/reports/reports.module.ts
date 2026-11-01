import { Router, type RequestHandler } from 'express';
import { reportEntriesQuerySchema, reportQuerySchema } from '@tempo/shared';
import type { PrismaClient } from '../../db/prisma.ts';
import type { Clock } from '../../lib/clock.ts';
import type { RateLimiter } from '../../middleware/rate-limit.ts';
import { validateQuery } from '../../middleware/validate.ts';
import { createSettingsRepository } from '../settings/settings.repository.ts';
import { createReportsController } from './reports.controller.ts';
import { createReportsRepository } from './reports.repository.ts';
import { createReportsService } from './reports.service.ts';

/** /reports: every role, scoped in the service (admin: all, PM: their projects, worker: own). */
export function createReportsModule(deps: {
  prisma: PrismaClient;
  clock: Clock;
  authenticate: RequestHandler;
  rateLimit: RateLimiter;
}): Router {
  const controller = createReportsController(
    createReportsService({
      reports: createReportsRepository(deps.prisma),
      settings: createSettingsRepository(deps.prisma),
      clock: deps.clock,
    }),
  );
  const router = Router();
  const query = validateQuery(reportQuerySchema);
  // Exports can be large; keep a single user from hammering the database with them.
  const exportLimit = deps.rateLimit({
    name: 'report-export',
    windowMs: 60_000,
    max: 20,
    key: (req) => req.auth?.userId ?? null,
  });
  // Every report read rebuilds the whole range (up to a year of the organization's entries).
  const readLimit = deps.rateLimit({
    name: 'report-read',
    windowMs: 60_000,
    max: 60,
    key: (req) => req.auth?.userId ?? null,
  });
  router.use(deps.authenticate);
  router.get('/', readLimit, query, controller.summary);
  router.get('/entries', readLimit, validateQuery(reportEntriesQuerySchema), controller.entries);
  router.get('/options', controller.options);
  router.get('/export.csv', exportLimit, query, controller.csv);
  router.get('/export.pdf', exportLimit, query, controller.pdf);
  return router;
}
