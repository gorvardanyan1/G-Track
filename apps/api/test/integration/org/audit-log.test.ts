import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLogResponseSchema, pageSchema } from '@tempo/shared';
import { createHarness, prisma, resetDatabase, type Harness } from '../auth/harness.ts';
import { setTimezone } from '../tracking/fixtures.ts';
import { createScenario, type Scenario } from './scenario.ts';

let h: Harness;
let s: Scenario;
const page = pageSchema(auditLogResponseSchema);

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  s = await createScenario(h);
  // Real actions at known times (all in Berlin, CET = UTC+1).
  h.setNow('2026-10-30T22:30:00Z'); // 23:30 on Oct 30
  await s.as('admin').post('/clients').send({ name: 'Globex' });
  h.setNow('2026-10-30T23:30:00Z'); // 00:30 on Oct 31
  await s
    .as('workerA')
    .post('/time-entries')
    .send({
      projectId: s.projectA.id,
      start: { date: '2026-10-30', time: '09:00' },
      end: { date: '2026-10-30', time: '10:00' },
    });
  h.setNow('2026-10-31T10:00:00Z');
  await s.as('admin').patch('/settings').send({ name: 'Acme' });
});
afterAll(async () => {
  await prisma().$disconnect();
});

const list = async (q = '') => {
  const res = await s.as('admin').get(`/audit-logs${q}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return page.parse(res.body);
};
const actions = (p: { items: { action: string }[] }) => p.items.map((i) => i.action);

describe('audit log', () => {
  it('lists newest first with actor, target, before/after and request metadata', async () => {
    const all = await list();
    expect(actions(all)).toEqual(['settings.updated', 'time_entry.created', 'client.created']);
    expect(all.total).toBe(3);
    const [settings] = all.items;
    expect(settings).toMatchObject({
      createdAt: '2026-10-31T10:00:00.000Z',
      actor: { id: s.users.admin.id, name: 'Ada Admin', email: 'admin@tempo.test' },
      targetType: 'org_settings',
      before: { name: 'TEMPO' },
      after: { name: 'Acme' },
    });
    expect(settings?.ip).toBeTruthy();
    expect(settings?.requestId).toBeTruthy();
  });

  it('filters by action (exact or prefix), actor and target', async () => {
    expect(actions(await list('?action=client.created'))).toEqual(['client.created']);
    expect(actions(await list('?action=time_entry.'))).toEqual(['time_entry.created']);
    expect(actions(await list('?action=client.created,settings.updated'))).toEqual([
      'settings.updated',
      'client.created',
    ]);
    expect(actions(await list(`?actorId=${s.users.workerA.id}`))).toEqual(['time_entry.created']);
    expect(actions(await list('?targetType=org_settings&targetId=1'))).toEqual([
      'settings.updated',
    ]);
  });

  it('filters by local date in the viewer’s timezone', async () => {
    expect(actions(await list('?from=2026-10-31&to=2026-10-31'))).toEqual([
      'settings.updated',
      'time_entry.created',
    ]);
    expect(actions(await list('?to=2026-10-30'))).toEqual(['client.created']);
    // In New York (UTC−4) the first two happened in the evening of Oct 30.
    await setTimezone(s.users.admin.id, 'America/New_York');
    expect(actions(await list('?to=2026-10-30'))).toEqual(['time_entry.created', 'client.created']);
  });

  it('paginates', async () => {
    const second = await list('?page=2&pageSize=2');
    expect(second).toMatchObject({ total: 3, page: 2, pageSize: 2 });
    expect(actions(second)).toEqual(['client.created']);
  });

  it('lists the known action names', async () => {
    const res = await s.as('admin').get('/audit-logs/actions');
    expect(res.body).toEqual(expect.arrayContaining(['timesheet.approved', 'settings.updated']));
  });

  it('validates filters', async () => {
    expect((await s.as('admin').get('/audit-logs?action=DROP TABLE')).status).toBe(400);
    expect((await s.as('admin').get('/audit-logs?from=2026-10-31&to=2026-10-30')).status).toBe(400);
  });

  it.each(['pmA', 'workerA'] as const)('is hidden from %s (404)', async (who) => {
    expect((await s.as(who).get('/audit-logs')).status).toBe(404);
    expect((await s.as(who).get('/audit-logs/actions')).status).toBe(404);
  });
});
