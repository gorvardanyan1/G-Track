// CLI entry for `prisma db seed` / `npm run db:seed`. Development data only.
import { z } from 'zod';
import { createPrismaClient } from '../../src/db/prisma.ts';
import { createLogger } from '../../src/lib/logger.ts';
import { runSeed } from './run.ts';

const seedEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  SEED_PASSWORD: z.string().min(12).default('TempoDev!2026'),
});

const env = seedEnvSchema.parse(process.env);
const logger = createLogger({ LOG_LEVEL: 'info' });

if (env.NODE_ENV === 'production') {
  logger.fatal('refusing to seed: NODE_ENV is production');
  process.exit(1);
}

const prisma = createPrismaClient(env.DATABASE_URL);
try {
  const summary = await runSeed(prisma, { password: env.SEED_PASSWORD });
  logger.info(summary, 'seed complete');
} finally {
  await prisma.$disconnect();
}
