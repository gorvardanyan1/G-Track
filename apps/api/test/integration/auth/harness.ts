import { randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Express } from 'express';
import { pino, type Logger } from 'pino';
import request from 'supertest';
import { REFRESH_COOKIE_NAME, UserRole } from '@tempo/shared';
import { createApi, type AppDeps } from '../../../src/app.ts';
import { createPrismaClient, type PrismaClient } from '../../../src/db/prisma.ts';
import type { BackgroundRunner } from '../../../src/lib/background.ts';
import { createEventBus } from '../../../src/lib/event-bus.ts';
import { createJwtService } from '../../../src/lib/jwt.ts';
import { createMemoryMailer } from '../../../src/lib/mailer.ts';
import { hashPassword } from '../../../src/lib/password.ts';
import { createSecretBox } from '../../../src/lib/secret-box.ts';
import { randomToken, sha256Hex } from '../../../src/lib/tokens.ts';
import { generateTotp } from '../../../src/lib/totp.ts';
import { testDatabaseUrl } from '../test-database.ts';

export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'correct horse battery staple';

export const env: AppDeps['env'] = {
  CORS_ORIGINS: [ORIGIN],
  BODY_LIMIT: '100kb',
  TRUST_PROXY: 0,
  JWT_SECRET: 'integration-test-jwt-secret-long-enough',
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
  REFRESH_TOKEN_TTL_DAYS: 14,
  WEB_APP_URL: 'https://app.tempo.test',
};

let sharedPrisma: PrismaClient | undefined;
export function prisma(): PrismaClient {
  return (sharedPrisma ??= createPrismaClient(testDatabaseUrl()));
}

export async function resetDatabase(): Promise<void> {
  await prisma().$executeRaw`
    TRUNCATE TABLE audit_logs, time_entries, timesheet_reviews, timesheets, project_members, tasks, projects,
      clients, refresh_tokens, recovery_codes, password_resets, invites, org_settings, users
    RESTART IDENTITY CASCADE`;
}

/** A fresh app (fresh rate limiter) with a controllable clock, memory mailer and log capture. */
export function createHarness() {
  let now = Math.floor(Date.now() / 1000) * 1000;
  const mailer = createMemoryMailer();
  const pending: Promise<unknown>[] = [];
  const failures: unknown[] = [];
  // Collect background work so tests can await it and see its errors (instead of unhandled
  // rejections leaking into the next test).
  const background: BackgroundRunner = {
    run: (_name, task) => void pending.push(task().catch((err: unknown) => failures.push(err))),
  };
  const logLines: string[] = [];
  const logger: Logger = pino(
    { level: 'trace' },
    { write: (line: string) => void logLines.push(line) },
  );

  const clock = () => new Date(now);
  const events = createEventBus(logger);
  const built = createApi({ env, logger, prisma: prisma(), mailer, background, clock, events });
  const app: Express = built.app;
  const jwt = createJwtService(env.JWT_SECRET, clock);

  /** Request helper for any /api/v1 route, optionally authenticated. */
  const apiRequest = (token?: string) => {
    const withAuth = (req: request.Test) => {
      void req.set('Origin', ORIGIN);
      return token ? req.set('Authorization', `Bearer ${token}`) : req;
    };
    return {
      get: (path: string) => withAuth(request(app).get(`/api/v1${path}`)),
      post: (path: string) => withAuth(request(app).post(`/api/v1${path}`)),
      put: (path: string) => withAuth(request(app).put(`/api/v1${path}`)),
      patch: (path: string) => withAuth(request(app).patch(`/api/v1${path}`)),
      delete: (path: string) => withAuth(request(app).delete(`/api/v1${path}`)),
    };
  };

  return {
    app,
    api: apiRequest,
    events,
    clock,
    /** Serves the app with Socket.io on a random local port. */
    async listen() {
      const server: Server = createServer(app);
      const realtime = built.attachRealtime(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const { port } = server.address() as AddressInfo;
      return { url: `http://127.0.0.1:${port}`, realtime, close: () => realtime.close() };
    },
    /**
     * Signs a user in without the login flow (no password hashing, no rate limits): creates a
     * session row and an access token exactly like the session service does.
     */
    async sessionToken(userId: string): Promise<string> {
      return (await this.session(userId))();
    },
    /**
     * Like sessionToken, but returns a signer that mints a fresh access token at the current
     * (test) time on every call — for tests that move the clock beyond 15 minutes.
     */
    async session(userId: string): Promise<(ttlSeconds?: number) => string> {
      const familyId = randomUUID();
      await prisma().refreshToken.create({
        data: {
          userId,
          familyId,
          tokenHash: sha256Hex(randomToken()),
          expiresAt: new Date(now + 14 * 86_400_000),
        },
      });
      return (ttlSeconds = 900) =>
        jwt.sign({ sub: userId, typ: 'access', sid: familyId }, ttlSeconds).token;
    },
    mailer,
    logLines,
    now: () => new Date(now),
    advance: (ms: number) => void (now += ms),
    setNow: (iso: string) => void (now = Date.parse(iso)),
    /** Waits for background tasks; throws if any of them failed. Call before the test ends. */
    drainBackground: async () => {
      await Promise.all(pending.splice(0));
      if (failures.length > 0) throw failures.splice(0)[0];
    },
    post: (path: string) => request(app).post(`/api/v1/auth${path}`).set('Origin', ORIGIN),
    get: (path: string) => request(app).get(`/api/v1/auth${path}`),
  };
}

export type Harness = ReturnType<typeof createHarness>;

const totpBox = createSecretBox(env.TOTP_ENCRYPTION_KEY);
let passwordHash: Promise<string> | undefined;

export async function createUser(options: {
  email: string;
  role?: UserRole;
  name?: string;
  isActive?: boolean;
  totpSecret?: string;
}) {
  const user = await prisma().user.create({
    data: {
      email: options.email,
      name: options.name ?? 'Test User',
      role: options.role ?? UserRole.WORKER,
      timezone: 'Europe/Berlin',
      isActive: options.isActive ?? true,
      passwordHash: await (passwordHash ??= hashPassword(PASSWORD)),
    },
  });
  if (options.totpSecret) {
    return prisma().user.update({
      where: { id: user.id },
      data: {
        totpSecretEncrypted: totpBox.encrypt(options.totpSecret, user.id),
        totpEnabledAt: new Date(),
      },
    });
  }
  return user;
}

/** A known TOTP secret for tests (base32). */
export const TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
export const totpNow = (h: Harness, secret = TOTP_SECRET) => generateTotp(secret, h.now());

interface CookieInfo {
  value: string;
  attributes: string[];
}

/** The refresh cookie from a response (supertest won't send Secure cookies over http itself). */
export function refreshCookie(res: { headers: Record<string, unknown> }): CookieInfo | null {
  const header = res.headers['set-cookie'];
  const cookies = Array.isArray(header) ? (header as string[]) : [];
  const cookie = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE_NAME}=`));
  if (!cookie) return null;
  const [pair, ...attributes] = cookie.split(';').map((p) => p.trim());
  return { value: pair?.slice(REFRESH_COOKIE_NAME.length + 1) ?? '', attributes };
}

export const cookieHeader = (value: string) => `${REFRESH_COOKIE_NAME}=${value}`;

export interface Session {
  accessToken: string;
  refreshToken: string;
}

/** Password login for a user without 2FA. */
export async function login(h: Harness, email: string, password = PASSWORD): Promise<Session> {
  const res = await h.post('/login').send({ email, password });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const body = res.body as { status: string; accessToken: string };
  const cookie = refreshCookie(res);
  if (body.status !== 'authenticated' || !cookie)
    throw new Error(`unexpected login: ${body.status}`);
  return { accessToken: body.accessToken, refreshToken: cookie.value };
}

export const bearer = (token: string) => `Bearer ${token}`;

export async function auditActions(): Promise<string[]> {
  const rows = await prisma().auditLog.findMany({
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { action: true },
  });
  return rows.map((r) => r.action);
}

export function body<T = Record<string, unknown>>(res: { body: unknown }): T {
  return res.body as T;
}

export function errorCode(res: { body: unknown }): string | undefined {
  return (res.body as { error?: { code?: string } }).error?.code;
}
