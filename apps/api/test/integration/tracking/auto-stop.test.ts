import { pino } from 'pino';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createJobs } from '../../../src/jobs.ts';
import { createHarness, prisma, resetDatabase, type Harness } from '../auth/harness.ts';
import { createScenario, type Scenario } from '../org/scenario.ts';
import { insertEntry, setOrgSettings } from './fixtures.ts';

let h: Harness;
let s: Scenario;

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  h.setNow('2026-10-31T22:00:00Z');
  s = await createScenario(h);
});
afterAll(async () => {
  await prisma().$disconnect();
});

const job = () =>
  createJobs({ prisma: prisma(), logger: pino({ level: 'silent' }), clock: h.now }).autoStop;

describe('auto-stop job', () => {
  it('stops timers longer than the max at start + max, flags and audits them', async () => {
    const long = await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-31T08:00:00Z',
      endedAt: null,
      source: 'TIMER',
    });
    const fresh = await insertEntry({
      userId: s.users.workerB.id,
      projectId: s.projectB.id,
      startedAt: '2026-10-31T11:00:00Z',
      endedAt: null,
      source: 'TIMER',
    });

    expect(await job().run()).toBe(1);

    const stopped = await prisma().timeEntry.findUniqueOrThrow({ where: { id: long.id } });
    expect(stopped).toMatchObject({ source: 'AUTO_STOPPED', durationSeconds: 12 * 3600 });
    expect(stopped.endedAt?.toISOString()).toBe('2026-10-31T20:00:00.000Z');
    expect(
      (await prisma().timeEntry.findUniqueOrThrow({ where: { id: fresh.id } })).endedAt,
    ).toBeNull();

    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'time_entry.auto_stopped' },
    });
    expect(audit).toMatchObject({
      actorId: null,
      targetId: long.id,
      after: { userId: s.users.workerA.id, maxTimerDurationSeconds: 43200 },
    });
  });

  it('stops a timer exactly at the limit, not a second before', async () => {
    await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-31T10:00:01Z',
      endedAt: null,
      source: 'TIMER',
    });
    expect(await job().run()).toBe(0);
    h.advance(1000);
    expect(await job().run()).toBe(1);
  });

  it('uses the org setting', async () => {
    await setOrgSettings({ maxTimerDurationSeconds: 2 * 3600 });
    await insertEntry({
      userId: s.users.workerB.id,
      projectId: s.projectB.id,
      startedAt: '2026-10-31T19:30:00Z',
      endedAt: null,
      source: 'TIMER',
    });
    expect(await job().run()).toBe(1);
    const entry = await prisma().timeEntry.findFirstOrThrow({
      where: { userId: s.users.workerB.id },
    });
    expect(entry.durationSeconds).toBe(2 * 3600);
  });

  it('is idempotent and leaves stopped entries alone', async () => {
    await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-30T08:00:00Z',
      endedAt: '2026-10-30T09:00:00Z',
    });
    await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-31T06:00:00Z',
      endedAt: null,
      source: 'TIMER',
    });
    expect(await job().run()).toBe(1);
    expect(await job().run()).toBe(0);
    expect(await prisma().auditLog.count({ where: { action: 'time_entry.auto_stopped' } })).toBe(1);
  });

  it('after auto-stop the worker can start a new timer', async () => {
    await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-31T06:00:00Z',
      endedAt: null,
      source: 'TIMER',
    });
    await job().run();
    expect(
      (await s.as('workerA').post('/timer/start').send({ projectId: s.projectA.id })).status,
    ).toBe(201);
  });
});
