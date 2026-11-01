import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { testDatabaseUrl } from './test-database.ts';

/** Recreates the test database schema from the migrations once per run. */
export default async function setup(): Promise<void> {
  const url = testDatabaseUrl();
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
    // A non-UTC default proves the app never relies on the server's session time zone.
    const { rows } = await client.query<{ db: string }>('SELECT current_database() AS db');
    await client.query(
      `ALTER DATABASE ${client.escapeIdentifier(rows[0]?.db ?? '')} SET TimeZone = 'Asia/Yerevan'`,
    );
  } finally {
    await client.end();
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
