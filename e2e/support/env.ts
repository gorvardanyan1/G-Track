import { fileURLToPath } from 'node:url';

const num = (name: string, fallback: number) => Number(process.env[name] ?? fallback);

/**
 * End-to-end runs (Playwright here, Cypress in apps/web/cypress) start their own api + web on
 * separate ports against their own database, so they never touch the dev database or a running
 * `npm run dev`. The seed truncates that database on every run. Overridable through
 * E2E_DATABASE_URL, E2E_API_PORT, E2E_WEB_PORT and E2E_OUTBOX_DIR.
 */
export const E2E = {
  databaseUrl:
    process.env['E2E_DATABASE_URL'] ?? 'postgresql://tempo:tempo@localhost:5434/tempo_e2e',
  apiPort: num('E2E_API_PORT', 3100),
  webPort: num('E2E_WEB_PORT', 5174),
  outboxDir: process.env['E2E_OUTBOX_DIR'] ?? fileURLToPath(new URL('../.outbox', import.meta.url)),
  /** Password of every seeded user. */
  password: 'TempoDev!2026',
} as const;

export const WEB_URL = `http://localhost:${E2E.webPort}`;
export const API_URL = `http://localhost:${E2E.apiPort}/api/v1`;

/** Throwaway keys for the e2e api only (never used anywhere else). */
export const E2E_SECRETS = {
  JWT_SECRET: 'e2e-only-jwt-secret-that-is-long-enough-123',
  TOTP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
} as const;

/** Environment of an e2e api process. */
export function apiEnv(extra: Record<string, string> = {}): Record<string, string> {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'warn',
    PORT: String(E2E.apiPort),
    DATABASE_URL: E2E.databaseUrl,
    CORS_ORIGINS: WEB_URL,
    WEB_APP_URL: WEB_URL,
    MAIL_OUTBOX_DIR: E2E.outboxDir,
    ...E2E_SECRETS,
    ...extra,
  };
}

/** The seed truncates every table: refuse anything that doesn't look like a throwaway database. */
export function assertE2eDatabase(url: string): void {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_e2e')) throw new Error(`E2E database name must end in _e2e (got "${name}")`);
}
