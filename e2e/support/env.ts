import { fileURLToPath } from 'node:url';

/**
 * E2E runs its own api + web on separate ports against its own database, so it never touches
 * the dev database or a running `npm run dev`. The seed truncates that database on every run.
 */
export const E2E = {
  databaseUrl:
    process.env['E2E_DATABASE_URL'] ?? 'postgresql://tempo:tempo@localhost:5434/tempo_e2e',
  apiPort: 3100,
  webPort: 5174,
  outboxDir: fileURLToPath(new URL('../.outbox', import.meta.url)),
  /** Password of every seeded user. */
  password: 'TempoDev!2026',
} as const;

export const WEB_URL = `http://localhost:${E2E.webPort}`;
export const API_URL = `http://localhost:${E2E.apiPort}/api/v1`;

/** The seed truncates every table: refuse anything that doesn't look like a throwaway database. */
export function assertE2eDatabase(url: string): void {
  const name = new URL(url).pathname.slice(1);
  if (!name.endsWith('_e2e')) throw new Error(`E2E database name must end in _e2e (got "${name}")`);
}
