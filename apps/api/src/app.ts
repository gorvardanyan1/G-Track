import type { Server as HttpServer } from 'node:http';
import express, { type Express } from 'express';
import helmet from 'helmet';
import type { Logger } from 'pino';
import { API_PREFIX } from '@tempo/shared';
import type { Env } from './config/env.ts';
import type { PrismaClient } from './db/prisma.ts';
import { createBackgroundRunner, type BackgroundRunner } from './lib/background.ts';
import { systemClock, type Clock } from './lib/clock.ts';
import { createEventBus, type EventBus } from './lib/event-bus.ts';
import type { Mailer } from './lib/mailer.ts';
import { corsAllowlist } from './middleware/cors.ts';
import { errorHandler, notFound } from './middleware/error-handler.ts';
import { noStore } from './middleware/no-store.ts';
import { createRateLimiter } from './middleware/rate-limit.ts';
import { requestId } from './middleware/request-id.ts';
import { requestLogger } from './middleware/request-logger.ts';
import { serverTime } from './middleware/server-time.ts';
import { createAuditLogModule } from './modules/audit/audit-log.module.ts';
import { createAuditRepository } from './modules/audit/audit.repository.ts';
import { createAuditService } from './modules/audit/audit.service.ts';
import { createAuthModule } from './modules/auth/auth.module.ts';
import { createClientsModule } from './modules/clients/clients.module.ts';
import { createProjectsModule } from './modules/projects/projects.module.ts';
import { attachRealtime, type Realtime } from './modules/realtime/realtime.server.ts';
import { createReportsModule } from './modules/reports/reports.module.ts';
import { createSettingsModule } from './modules/settings/settings.module.ts';
import { createTimeTrackingModule } from './modules/time-entries/time-tracking.module.ts';
import { createTimesheetsModule } from './modules/timesheets/timesheets.module.ts';
import { createUsersModule } from './modules/users/users.module.ts';
import { createApiRouter } from './routes.ts';

export interface AppDeps {
  env: Pick<
    Env,
    | 'CORS_ORIGINS'
    | 'BODY_LIMIT'
    | 'TRUST_PROXY'
    | 'JWT_SECRET'
    | 'TOTP_ENCRYPTION_KEY'
    | 'REFRESH_TOKEN_TTL_DAYS'
    | 'WEB_APP_URL'
  >;
  logger: Logger;
  prisma: PrismaClient;
  mailer: Mailer;
  clock?: Clock;
  background?: BackgroundRunner;
  /** Domain events (shared with background jobs); a private bus if omitted. */
  events?: EventBus;
}

export interface Api {
  app: Express;
  /** Starts Socket.io on the server the app listens on. */
  attachRealtime: (server: HttpServer) => Realtime;
}

export function createApp(deps: AppDeps): Express {
  return createApi(deps).app;
}

export function createApi({
  env,
  logger,
  prisma,
  mailer,
  clock = systemClock,
  background,
  events = createEventBus(logger),
}: AppDeps): Api {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY);
  app.disable('x-powered-by');

  const audit = createAuditService(createAuditRepository(prisma), clock);
  // One limiter per app instance, so tests (and future multi-app setups) don't share counters.
  const rateLimit = createRateLimiter(clock);
  const auth = createAuthModule({
    prisma,
    audit,
    mailer,
    background: background ?? createBackgroundRunner(logger),
    clock,
    rateLimit,
    events,
    config: {
      jwtSecret: env.JWT_SECRET,
      totpEncryptionKey: env.TOTP_ENCRYPTION_KEY,
      refreshTokenTtlDays: env.REFRESH_TOKEN_TTL_DAYS,
      webAppUrl: env.WEB_APP_URL,
      allowedOrigins: env.CORS_ORIGINS,
    },
  });

  app.use(serverTime());
  app.use(requestId());
  app.use(requestLogger(logger));
  app.use(helmet());
  app.use(corsAllowlist(env.CORS_ORIGINS));
  app.use(express.json({ limit: env.BODY_LIMIT }));

  const { authenticate } = auth;
  const tracking = createTimeTrackingModule({
    prisma,
    audit,
    clock,
    authenticate,
    rateLimit,
    events,
  });
  const modules = {
    timer: tracking.timerRouter,
    timeEntries: tracking.entriesRouter,
    auth: auth.router,
    users: createUsersModule({
      prisma,
      audit,
      clock,
      sessions: auth.sessions,
      authenticate,
      createInvite: auth.createInvite,
      rateLimit,
      events,
    }),
    clients: createClientsModule({ prisma, audit, clock, authenticate }),
    projects: createProjectsModule({ prisma, audit, clock, authenticate, events }),
    timesheets: createTimesheetsModule({ prisma, audit, clock, authenticate, events }),
    reports: createReportsModule({ prisma, clock, authenticate, rateLimit }),
    settings: createSettingsModule({ prisma, audit, clock, authenticate }),
    auditLogs: createAuditLogModule({ prisma, authenticate }),
  };

  app.use(API_PREFIX, noStore(), createApiRouter(modules));

  app.use(notFound());
  app.use(errorHandler(logger));
  return {
    app,
    attachRealtime: (server) =>
      attachRealtime(server, {
        prisma,
        sessions: auth.sessions,
        events,
        clock,
        logger,
        allowedOrigins: env.CORS_ORIGINS,
      }),
  };
}
