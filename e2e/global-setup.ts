import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import pg from 'pg';
import { assertE2eDatabase, E2E } from './support/env.ts';

/** A fresh, seeded database and an empty mail outbox for every run. */
export default async function globalSetup(): Promise<void> {
  assertE2eDatabase(E2E.databaseUrl);
  const url = new URL(E2E.databaseUrl);
  const name = url.pathname.slice(1);
  url.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: url.toString() });
  await admin.connect();
  try {
    const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    // Identifiers can't be parameters; the name was checked above (…_e2e) and is quoted.
    if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${name.replace(/"/g, '')}"`);
  } finally {
    await admin.end();
  }

  const env = { ...process.env, DATABASE_URL: E2E.databaseUrl, SEED_PASSWORD: E2E.password };
  for (const script of ['db:deploy', 'db:seed'])
    execFileSync('npm', ['run', script, '-w', '@tempo/api'], { env, stdio: 'pipe' });
  await rm(E2E.outboxDir, { recursive: true, force: true });
}
