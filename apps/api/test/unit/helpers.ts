import express, { type Express } from 'express';
import { pino } from 'pino';
import { createApp, type AppDeps } from '../../src/app.ts';
import { createPrismaClient } from '../../src/db/prisma.ts';
import { createMemoryMailer } from '../../src/lib/mailer.ts';
import { errorHandler, notFound } from '../../src/middleware/error-handler.ts';
import { requestId } from '../../src/middleware/request-id.ts';
import { requestLogger } from '../../src/middleware/request-logger.ts';
import { serverTime } from '../../src/middleware/server-time.ts';

export const silentLogger = pino({ level: 'silent' });

export const testEnv: AppDeps['env'] = {
  CORS_ORIGINS: ['http://localhost:5173'],
  BODY_LIMIT: '1kb',
  TRUST_PROXY: 0,
  JWT_SECRET: 'unit-test-jwt-secret-that-is-long-enough',
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  REFRESH_TOKEN_TTL_DAYS: 14,
  WEB_APP_URL: 'http://localhost:5173',
};

// Prisma connects lazily; unit tests never hit a route that queries, so no database is needed.
const unusedPrisma = createPrismaClient('postgresql://unused@127.0.0.1:1/unused');

export function buildTestApp(): Express {
  return createApp({
    env: testEnv,
    logger: silentLogger,
    prisma: unusedPrisma,
    mailer: createMemoryMailer(),
  });
}

/** Minimal app with the real error pipeline, for mounting throwaway routes in tests. */
export function buildErrorTestApp(mount: (app: Express) => void): Express {
  const app = express();
  app.use(serverTime());
  app.use(requestId());
  app.use(requestLogger(silentLogger));
  app.use(express.json({ limit: '1kb' }));
  mount(app);
  app.use(notFound());
  app.use(errorHandler(silentLogger));
  return app;
}
