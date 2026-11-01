import { existsSync } from 'node:fs';

/**
 * TEST_DATABASE_URL from the environment or apps/api/.env.test / .env. The database name
 * must end in "_test": integration tests drop and recreate its schema.
 */
export function testDatabaseUrl(): string {
  for (const file of ['.env.test', '.env']) {
    if (!process.env['TEST_DATABASE_URL'] && existsSync(file)) process.loadEnvFile(file);
  }
  const raw = process.env['TEST_DATABASE_URL'];
  if (!raw) {
    throw new Error(
      'TEST_DATABASE_URL is not set. Start the test DB with `npm run db:test:up` and set it in apps/api/.env (see .env.example).',
    );
  }
  const name = new URL(raw).pathname.slice(1);
  if (!name.endsWith('_test')) {
    throw new Error(`Refusing to run integration tests against "${name}": name must end in _test`);
  }
  return raw;
}
