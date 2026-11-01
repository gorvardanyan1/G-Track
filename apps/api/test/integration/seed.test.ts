import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runSeed, type SeedSummary } from '../../prisma/seed/run.ts';
import { createPrismaClient, type PrismaClient } from '../../src/db/prisma.ts';
import { verifyPassword } from '../../src/lib/password.ts';
import { testDatabaseUrl } from './test-database.ts';

// Fixed clock: six weeks back covers Europe/Berlin's 2026-10-25 DST change.
const NOW = new Date('2026-10-31T15:00:00Z');
const PASSWORD = 'seed-test-password';

let prisma: PrismaClient;
let summary: SeedSummary;

beforeAll(async () => {
  prisma = createPrismaClient(testDatabaseUrl());
  summary = await runSeed(prisma, { password: PASSWORD, now: NOW });
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe('seed', () => {
  it('creates the expected users, clients and projects', async () => {
    const roles = await prisma.user.groupBy({
      by: ['role'],
      _count: true,
      orderBy: { role: 'asc' },
    });
    expect(roles.map((r) => [r.role, r._count])).toEqual([
      ['SUPER_ADMIN', 1],
      ['PROJECT_MANAGER', 2],
      ['WORKER', 6],
    ]);
    expect(await prisma.client.count()).toBe(2);
    expect(await prisma.project.count()).toBe(4);
    expect(await prisma.task.count()).toBeGreaterThanOrEqual(12);
    expect(await prisma.orgSettings.count()).toBe(1);
  });

  it('spreads workers across the three time zones', async () => {
    const zones = await prisma.user.groupBy({
      by: ['timezone'],
      where: { role: 'WORKER' },
      _count: true,
    });
    expect(Object.fromEntries(zones.map((z) => [z.timezone, z._count]))).toEqual({
      'Asia/Yerevan': 2,
      'Europe/Berlin': 2,
      'America/New_York': 2,
    });
  });

  it('gives every project a PM and workers', async () => {
    const projects = await prisma.project.findMany({ include: { members: true } });
    for (const project of projects) {
      expect(project.members.filter((m) => m.roleInProject === 'PM')).toHaveLength(1);
      expect(project.members.filter((m) => m.roleInProject === 'WORKER').length).toBeGreaterThan(0);
    }
  });

  it('hashes passwords with argon2id', async () => {
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: 'admin@tempo.test' } });
    expect(admin.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(PASSWORD, admin.passwordHash)).toBe(true);
  });

  it('creates six weeks of entries for every worker, none after "now"', async () => {
    expect(summary.timeEntries).toBeGreaterThan(500);
    const [stats] = await prisma.$queryRaw<{ workers: number; first: Date; last: Date }[]>`
      SELECT count(DISTINCT user_id)::int AS workers, min(started_at) AS first,
             max(coalesce(ended_at, started_at)) AS last
      FROM time_entries`;
    expect(stats?.workers).toBe(6);
    expect(stats?.first.getTime()).toBeGreaterThan(NOW.getTime() - 43 * 86_400_000);
    expect(stats?.last.getTime()).toBeLessThanOrEqual(NOW.getTime());
  });

  it('includes entries that cross midnight in the worker’s own time zone', async () => {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n
      FROM time_entries e JOIN users u ON u.id = e.user_id
      WHERE (e.started_at AT TIME ZONE u.timezone)::date <> (e.ended_at AT TIME ZONE u.timezone)::date`;
    expect(row?.n).toBeGreaterThanOrEqual(5);
  });

  it('starts workdays at plausible local times in every zone', async () => {
    const rows = await prisma.$queryRaw<{ timezone: string; earliest: string }[]>`
      SELECT u.timezone, min((e.started_at AT TIME ZONE u.timezone)::time)::text AS earliest
      FROM time_entries e JOIN users u ON u.id = e.user_id GROUP BY u.timezone`;
    for (const row of rows) expect(row.earliest >= '08:00:00').toBe(true);
  });

  it('leaves at most one running timer per worker', async () => {
    const running = await prisma.timeEntry.groupBy({
      by: ['userId'],
      where: { endedAt: null },
      _count: true,
    });
    expect(running.length).toBe(summary.runningTimers);
    expect(running.every((r) => r._count === 1)).toBe(true);
  });

  it('only puts entries on projects the worker is a member of', async () => {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM time_entries e
      LEFT JOIN project_members m ON m.project_id = e.project_id AND m.user_id = e.user_id
      WHERE m.user_id IS NULL`;
    expect(row?.n).toBe(0);
  });

  it('is repeatable: running it again yields the same data', async () => {
    const again = await runSeed(prisma, { password: PASSWORD, now: NOW });
    expect(again).toEqual(summary);
    expect(await prisma.user.count()).toBe(9);
  });
});
