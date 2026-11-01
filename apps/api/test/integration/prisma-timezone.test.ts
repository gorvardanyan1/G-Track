import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from '../../src/db/prisma.ts';
import { testDatabaseUrl } from './test-database.ts';

// The test database's default TimeZone is Asia/Yerevan (see global-setup.ts). The Prisma pg
// adapter is only correct when the session zone is UTC, so createPrismaClient must force it.
let prisma: PrismaClient;

beforeAll(() => {
  prisma = createPrismaClient(testDatabaseUrl());
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('Prisma session time zone', () => {
  it('runs every session in UTC regardless of the database default', async () => {
    const [row] = await prisma.$queryRaw<
      { tz: string }[]
    >`SELECT current_setting('TimeZone') AS tz`;
    expect(row?.tz).toBe('UTC');
  });

  it('stores the exact instant it was given', async () => {
    const instant = new Date('2026-01-01T00:00:00Z');
    const [row] = await prisma.$queryRaw<{ epoch: number }[]>`
      SELECT extract(epoch FROM ${instant}::timestamptz)::float8 AS epoch`;
    expect(row?.epoch).toBe(instant.getTime() / 1000);
  });
});
