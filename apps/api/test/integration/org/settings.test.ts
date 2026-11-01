import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { orgSettingsResponseSchema } from '@tempo/shared';
import { createHarness, prisma, resetDatabase, type Harness } from '../auth/harness.ts';
import { errorBody, insertEntry } from '../tracking/fixtures.ts';
import { createScenario, type Scenario } from './scenario.ts';

let h: Harness;
let s: Scenario;

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  h.setNow('2026-10-31T12:00:00Z');
  s = await createScenario(h);
});
afterAll(async () => {
  await prisma().$disconnect();
});

const patch = (body: Record<string, unknown>, who: Parameters<Scenario['as']>[0] = 'admin') =>
  s.as(who).patch('/settings').send(body);

describe('organization settings', () => {
  it('shows the defaults until first saved', async () => {
    const res = await s.as('admin').get('/settings');
    expect(orgSettingsResponseSchema.parse(res.body)).toEqual({
      name: 'TEMPO',
      defaultTimezone: 'UTC',
      weekStartDay: 1,
      roundingMinutes: 0,
      roundingMode: 'NEAREST',
      maxTimerDurationSeconds: 43_200,
      timesheetApprovalEnabled: true,
      lockAfterDays: null,
      updatedAt: null,
      updatedBy: null,
    });
  });

  it('saves changes and audits exactly the changed fields', async () => {
    const res = await patch({
      name: 'Acme',
      defaultTimezone: 'Asia/Yerevan',
      roundingMinutes: 15,
      roundingMode: 'UP',
      lockAfterDays: 30,
      weekStartDay: 1, // unchanged: not audited
      id: 2, // unknown keys are stripped
    });
    expect(res.status).toBe(200);
    expect(orgSettingsResponseSchema.parse(res.body)).toMatchObject({
      name: 'Acme',
      defaultTimezone: 'Asia/Yerevan',
      roundingMinutes: 15,
      roundingMode: 'UP',
      lockAfterDays: 30,
      updatedAt: '2026-10-31T12:00:00.000Z',
      updatedBy: { id: s.users.admin.id, name: 'Ada Admin' },
    });
    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'settings.updated' },
    });
    expect(audit.before).toEqual({
      name: 'TEMPO',
      defaultTimezone: 'UTC',
      roundingMinutes: 0,
      roundingMode: 'NEAREST',
      lockAfterDays: null,
    });
    expect(audit.after).toEqual({
      name: 'Acme',
      defaultTimezone: 'Asia/Yerevan',
      roundingMinutes: 15,
      roundingMode: 'UP',
      lockAfterDays: 30,
    });

    // Saving the same values again changes nothing and writes no audit row.
    expect((await patch({ name: 'Acme' })).status).toBe(200);
    expect(await prisma().auditLog.count({ where: { action: 'settings.updated' } })).toBe(1);
  });

  it.each([
    [{ defaultTimezone: '+04:00' }],
    [{ weekStartDay: 0 }],
    [{ roundingMinutes: 61 }],
    [{ roundingMode: 'SIDEWAYS' }],
    [{ maxTimerDurationSeconds: 59 }],
    [{ maxTimerDurationSeconds: 86_401 }],
    [{ lockAfterDays: 0 }],
    [{ name: '' }],
    [{}],
  ])('rejects %j', async (body) => {
    expect(errorBody(await patch(body)).code).toBe('VALIDATION_ERROR');
  });

  it.each(['pmA', 'workerA'] as const)('is hidden from %s (404)', async (who) => {
    expect((await s.as(who).get('/settings')).status).toBe(404);
    expect((await patch({ name: 'Mine now' }, who)).status).toBe(404);
    expect(await prisma().orgSettings.count()).toBe(0);
  });

  it('takes effect immediately: the lock period', async () => {
    const entry = await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-01T08:00:00Z',
      endedAt: '2026-10-01T09:00:00Z',
    });
    const edit = () =>
      s.as('workerA').patch(`/time-entries/${entry.id}`).send({ description: 'edited' });
    expect((await edit()).status).toBe(200);
    await patch({ lockAfterDays: 14 });
    expect(errorBody(await edit()).code).toBe('PERIOD_LOCKED');
  });
});
