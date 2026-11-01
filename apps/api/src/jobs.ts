import type { Logger } from 'pino';
import type { PrismaClient } from './db/prisma.ts';
import type { Clock } from './lib/clock.ts';
import { createEventBus, type EventBus } from './lib/event-bus.ts';
import { createAuditRepository } from './modules/audit/audit.repository.ts';
import { createAuditService } from './modules/audit/audit.service.ts';
import { createSettingsRepository } from './modules/settings/settings.repository.ts';
import { createTimeEntriesRepository } from './modules/time-entries/time-entries.repository.ts';
import { createAutoStopJob } from './modules/timer/auto-stop.job.ts';

/** Background jobs; started by server.ts, run directly in tests. */
export function createJobs({
  prisma,
  logger,
  clock,
  events = createEventBus(logger),
}: {
  prisma: PrismaClient;
  logger: Logger;
  clock: Clock;
  /** The app's bus, so job results reach live connections. */
  events?: EventBus;
}) {
  return {
    autoStop: createAutoStopJob({
      entries: createTimeEntriesRepository(prisma),
      settings: createSettingsRepository(prisma),
      audit: createAuditService(createAuditRepository(prisma), clock),
      clock,
      logger,
      events,
    }),
  };
}
