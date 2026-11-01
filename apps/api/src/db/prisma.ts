import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

export function createPrismaClient(databaseUrl: string): PrismaClient {
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    // The pg adapter sends Dates as UTC wall-clock strings without an offset and drops the
    // offset when reading timestamptz back, so it is only correct if the session zone is UTC.
    // Force it per connection instead of trusting the server/database default.
    options: '-c TimeZone=UTC',
  });
  return new PrismaClient({ adapter });
}

export type { PrismaClient };
