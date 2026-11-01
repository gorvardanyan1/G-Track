import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { projectUsageDetailResponseSchema, projectUsageListResponseSchema } from '@tempo/shared';
import { createHarness, prisma, resetDatabase, type Harness } from '../auth/harness.ts';
import { insertEntry } from '../tracking/fixtures.ts';
import { createScenario, type Scenario } from './scenario.ts';

let h: Harness;
let s: Scenario;

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  // Saturday 31 Oct 2026, 13:00 in Berlin (CET). This week: Mon 26 Oct – Sun 1 Nov.
  h.setNow('2026-10-31T12:00:00Z');
  s = await createScenario(h);
  const { workerA, pmA, workerB } = s.users;
  // Sun 23:30 – Mon 00:30 local: 30 of its 60 minutes fall into this week.
  await insertEntry({
    userId: workerA.id,
    projectId: s.projectA.id,
    startedAt: '2026-10-25T22:30:00Z',
    endedAt: '2026-10-25T23:30:00Z',
  });
  await insertEntry({
    userId: workerA.id,
    projectId: s.projectA.id,
    startedAt: '2026-10-27T08:00:00Z',
    endedAt: '2026-10-27T09:00:00Z',
  });
  // The PM's running timer counts up to "now": 1 h.
  await insertEntry({
    userId: pmA.id,
    projectId: s.projectA.id,
    startedAt: '2026-10-31T11:00:00Z',
    endedAt: null,
    source: 'TIMER',
  });
  await insertEntry({
    userId: workerB.id,
    projectId: s.projectB.id,
    startedAt: '2026-09-01T08:00:00Z',
    endedAt: '2026-09-01T10:00:00Z',
  });
});
afterAll(async () => {
  await prisma().$disconnect();
});

const list = async (who: Parameters<Scenario['as']>[0]) => {
  const res = await s.as(who).get('/projects/usage');
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return projectUsageListResponseSchema.parse(res.body);
};

describe('GET /projects/usage', () => {
  it('gives a PM their active managed projects with all-time and this-week totals', async () => {
    const usage = await list('pmA');
    expect(usage.week).toEqual({ from: '2026-10-26', to: '2026-11-01' });
    expect(usage.timezone).toBe('Europe/Berlin');
    expect(usage.items).toEqual([
      {
        project: {
          id: s.projectA.id,
          name: 'Project A',
          color: '#5B5BF7',
          clientName: 'Northwind',
        },
        budgetHours: 100,
        totalSeconds: 3 * 3600,
        weekSeconds: 1800 + 3600 + 3600,
      },
    ]);
    expect((await list('pmB')).items.map((i) => i.project.name)).toEqual(['Project B']);
  });

  it('gives a Super Admin every active project', async () => {
    const usage = await list('admin');
    expect(usage.items.map((i) => [i.project.name, i.totalSeconds, i.weekSeconds])).toEqual([
      ['Project A', 3 * 3600, 9000],
      ['Project B', 2 * 3600, 0],
    ]);
  });

  it('follows the organization’s week start day', async () => {
    await prisma().orgSettings.create({
      data: { id: 1, name: 'Org', defaultTimezone: 'UTC', weekStartDay: 7 },
    });
    // Week Sun 25 – Sat 31 Oct: the whole midnight-crossing entry is inside it.
    const usage = await list('pmA');
    expect(usage.week).toEqual({ from: '2026-10-25', to: '2026-10-31' });
    expect(usage.items[0]?.weekSeconds).toBe(3 * 3600);
  });

  it('is not there for workers', async () => {
    expect((await s.as('workerA').get('/projects/usage')).status).toBe(404);
  });
});

describe('GET /projects/:id/usage', () => {
  it('splits the usage by person', async () => {
    const res = await s.as('pmA').get(`/projects/${s.projectA.id}/usage`);
    expect(res.status).toBe(200);
    const usage = projectUsageDetailResponseSchema.parse(res.body);
    expect(usage).toMatchObject({ totalSeconds: 10_800, weekSeconds: 9000, budgetHours: 100 });
    expect(usage.byMember).toEqual([
      {
        user: { id: s.users.workerA.id, name: 'Anahit Worker' },
        totalSeconds: 7200,
        weekSeconds: 5400,
      },
      { user: { id: s.users.pmA.id, name: 'Petra PM' }, totalSeconds: 3600, weekSeconds: 3600 },
    ]);
    expect((await s.as('admin').get(`/projects/${s.projectA.id}/usage`)).status).toBe(200);
  });

  it('is 403 for members, 404 for people who can’t see the project', async () => {
    expect((await s.as('workerA').get(`/projects/${s.projectA.id}/usage`)).status).toBe(403);
    expect((await s.as('pmB').get(`/projects/${s.projectA.id}/usage`)).status).toBe(404);
    expect((await s.as('outsider').get(`/projects/${s.projectA.id}/usage`)).status).toBe(404);
    expect((await s.as('admin').get('/projects/not-a-uuid/usage')).status).toBe(404);
  });
});
