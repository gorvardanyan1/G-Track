import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { reportEntriesResponseSchema, reportOptionsResponseSchema } from '@tempo/shared';
import { createHarness, prisma, resetDatabase, type Harness } from '../auth/harness.ts';
import { createScenario, type Scenario } from '../org/scenario.ts';
import { insertEntry } from '../tracking/fixtures.ts';

let h: Harness;
let s: Scenario;

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  h.setNow('2026-10-31T12:00:00Z');
  s = await createScenario(h);
  const { workerA, workerB } = s.users;
  // Sun 25 Oct 23:30 – Mon 00:30 in Berlin: one row per local day.
  await insertEntry({
    userId: workerA.id,
    projectId: s.projectA.id,
    taskId: s.taskA.id,
    startedAt: '2026-10-25T22:30:00Z',
    endedAt: '2026-10-25T23:30:00Z',
    description: 'late fix',
  });
  await insertEntry({
    userId: workerA.id,
    projectId: s.projectA.id,
    startedAt: '2026-10-27T08:00:00Z',
    endedAt: '2026-10-27T09:30:00Z',
  });
  await insertEntry({
    userId: workerB.id,
    projectId: s.projectB.id,
    startedAt: '2026-10-28T08:00:00Z',
    endedAt: '2026-10-28T09:00:00Z',
  });
});
afterAll(async () => {
  await prisma().$disconnect();
});

type Who = Parameters<Scenario['as']>[0];
const rows = async (who: Who, query = '') => {
  const res = await s.as(who).get(`/reports/entries?from=2026-10-25&to=2026-10-31${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return reportEntriesResponseSchema.parse(res.body);
};

describe('GET /reports/entries', () => {
  it('lists one row per entry per local day, newest first, with amounts for managers', async () => {
    const page = await rows('pmA');
    expect(page.total).toBe(3);
    expect(page.items.map((r) => [r.date, r.seconds, r.amountCents])).toEqual([
      ['2026-10-27', 5400, 12_000],
      ['2026-10-26', 1800, 4000],
      ['2026-10-25', 1800, 4000],
    ]);
    expect(page.items[2]).toMatchObject({
      start: '2026-10-25T22:30:00.000Z',
      end: '2026-10-25T23:00:00.000Z',
      task: { id: s.taskA.id, name: 'Design' },
      project: { name: 'Project A', clientName: 'Northwind' },
      user: { name: 'Anahit Worker' },
      description: 'late fix',
    });
    expect(new Set(page.items.map((r) => r.key)).size).toBe(3);
  });

  it('pages, filters and keeps the same scope as the report', async () => {
    const page = await rows('admin', '&pageSize=2&page=2');
    expect(page).toMatchObject({ total: 4, page: 2, pageSize: 2 });
    expect(page.items.map((r) => r.date)).toEqual(['2026-10-26', '2026-10-25']);

    expect((await rows('admin', `&userId=${s.users.workerB.id}`)).total).toBe(1);
    const own = await rows('workerA');
    expect(own.total).toBe(3);
    expect(own.items.every((r) => r.amountCents === null)).toBe(true);
    const foreign = await s
      .as('pmA')
      .get(`/reports/entries?from=2026-10-25&to=2026-10-31&projectId=${s.projectB.id}`);
    expect(foreign.status).toBe(404);
  });

  it('applies rounding to the rows', async () => {
    await prisma().orgSettings.create({
      data: { id: 1, name: 'Org', defaultTimezone: 'UTC', roundingMinutes: 60 },
    });
    const page = await rows('workerA', '&round=true');
    expect(page.items.map((r) => [r.seconds, r.rawSeconds])).toEqual([
      [7200, 5400],
      [1800, 1800],
      [1800, 1800],
    ]);
  });
});

describe('report reads are rate limited per user', () => {
  it('allows 60 a minute, then answers 429 until the window resets', async () => {
    const url = '/reports?from=2026-10-25&to=2026-10-31';
    for (let i = 0; i < 60; i += 1) expect((await s.as('workerB').get(url)).status).toBe(200);
    const limited = await s.as('workerB').get(url);
    expect(limited.status).toBe(429);
    expect(limited.headers['retry-after']).toBeDefined();
    // Per user: someone else is unaffected; and the limit resets after a minute.
    expect((await s.as('workerA').get(url)).status).toBe(200);
    h.advance(60_000);
    expect((await s.as('workerB').get(url)).status).toBe(200);
  });
});

describe('GET /reports/options', () => {
  const options = async (who: Who) => {
    const res = await s.as(who).get('/reports/options');
    expect(res.status).toBe(200);
    return reportOptionsResponseSchema.parse(res.body);
  };

  it('offers a PM their managed projects (archived too), their tasks and people', async () => {
    const o = await options('pmA');
    expect(o.projects.map((p) => [p.name, p.archived])).toEqual([
      ['Old Project', true],
      ['Project A', false],
    ]);
    expect(o.tasks).toEqual([{ id: s.taskA.id, projectId: s.projectA.id, name: 'Design' }]);
    expect(o.users.map((u) => u.name)).toEqual(['Anahit Worker', 'Petra PM']);
    expect(o.clients).toEqual([{ id: s.client.id, name: 'Northwind' }]);
  });

  it('offers a worker only their projects and themselves; an admin everything', async () => {
    const worker = await options('workerB');
    expect(worker.projects.map((p) => p.name)).toEqual(['Project B']);
    expect(worker.users).toEqual([{ id: s.users.workerB.id, name: 'Bob Worker' }]);

    const admin = await options('admin');
    expect(admin.projects).toHaveLength(3);
    expect(admin.users).toHaveLength(6);
    expect(admin.tasks).toHaveLength(2);
  });
});
