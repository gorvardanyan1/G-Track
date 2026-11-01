import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// Prisma 7 no longer reads .env itself; load it like the api does.
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node prisma/seed/index.ts',
  },
  // `prisma generate` doesn't need a database, so DATABASE_URL may be absent there.
  ...(process.env['DATABASE_URL'] && { datasource: { url: process.env['DATABASE_URL'] } }),
});
