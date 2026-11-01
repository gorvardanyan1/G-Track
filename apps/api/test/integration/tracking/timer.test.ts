import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { timerResponseSchema } from '@tempo/shared';
import { createHarness, prisma, resetDatabase, type Harness } from '../auth/harness.ts';
import { createScenario, type Scenario } from '../org/scenario.ts';
import { errorBody, insertEntry, setOrgSettings, setTimesheet } from './fixtures.ts';

let h: Harness;
let s: Scenario;

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  h.setNow('2026-10-31T10:00:00.700Z');
  s = await createScenario(h);
});
afterAll(async () => {
  await prisma().$disconnect();
});

const start = (
  who: Parameters<Scenario['as']>[0] = 'workerA',
  body: Record<string, unknown> = {},
) =>
  s
    .as(who)
    .post('/timer/start')
    .send({ projectId: s.projectA.id, ...body });
const entriesOf = (userId: string) =>
  prisma().timeEntry.findMany({ where: { userId }, orderBy: { startedAt: 'asc' } });

describe('POST /timer/start', () => {
  it('starts at server time (truncated to the second), ignoring any client timestamp', async () => {
    const res = await start('workerA', {
      taskId: s.taskA.id,
      description: 'Wireframes',
      startedAt: '2020-01-01T00:00:00Z',
    });
    expect(res.status).toBe(201);
    const { entry, serverTime } = timerResponseSchema.parse(res.body);
    expect(entry).toMatchObject({
      startedAt: '2026-10-31T10:00:00.000Z',
      endedAt: null,
      durationSeconds: null,
      description: 'Wireframes',
      task: { name: 'Design' },
      source: 'TIMER',
      isBillable: true,
      editable: true,
    });
    expect(serverTime).toBe('2026-10-31T10:00:00.700Z');
  });

  it('stops the running timer and starts the new one back-to-back', async () => {
    await start();
    h.advance(25 * 60_000);
    await start('workerA', { description: 'Second' });

    const [first, second] = await entriesOf(s.users.workerA.id);
    expect(first?.endedAt?.toISOString()).toBe('2026-10-31T10:25:00.000Z');
    expect(first?.durationSeconds).toBe(25 * 60);
    expect(second).toMatchObject({
      startedAt: first?.endedAt,
      endedAt: null,
      description: 'Second',
    });
  });

  it('replaces a zero-length timer restarted within the same second', async () => {
    await start('workerA', { description: 'Oops' });
    await start('workerA', { description: 'Right one' });
    const entries = await entriesOf(s.users.workerA.id);
    expect(entries.map((e) => e.description)).toEqual(['Right one']);
  });

  it('handles concurrent starts: every request succeeds, exactly one timer runs', async () => {
    await start('workerA', { description: 'Before' });
    h.advance(60_000);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => start('workerA', { description: `Concurrent ${i}` })),
    );
    expect(results.map((r) => r.status)).toEqual(Array(8).fill(201));

    const entries = await entriesOf(s.users.workerA.id);
    expect(entries.filter((e) => e.endedAt === null)).toHaveLength(1);
    // The earlier timer was stopped exactly once; same-second duplicates were replaced.
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ description: 'Before', durationSeconds: 60 });
  });

  it('keeps users independent', async () => {
    await Promise.all([
      start('workerA'),
      s.as('workerB').post('/timer/start').send({ projectId: s.projectB.id }),
    ]);
    expect(await prisma().timeEntry.count({ where: { endedAt: null } })).toBe(2);
  });

  it('defaults billable from the project and honours an explicit value', async () => {
    await prisma().project.update({ where: { id: s.projectA.id }, data: { isBillable: false } });
    expect(timerResponseSchema.parse((await start()).body).entry?.isBillable).toBe(false);
    h.advance(1000);
    expect(
      timerResponseSchema.parse((await start('workerA', { isBillable: true })).body).entry
        ?.isBillable,
    ).toBe(true);
  });

  it('only allows assigned, active projects and their own tasks', async () => {
    expect((await start('workerA', { projectId: s.projectB.id })).status).toBe(404);
    expect((await start('outsider')).status).toBe(404);
    expect((await start('workerA', { taskId: s.taskB.id })).status).toBe(404);
    expect((await start('workerA', { projectId: s.archived.id })).status).toBe(409);
    expect((await start('workerA', { projectId: 'not-a-uuid' })).status).toBe(400);
  });

  it('refuses to start in a week whose timesheet is submitted', async () => {
    await setTimesheet(s.users.workerA.id, '2026-10-26', 'SUBMITTED');
    const res = await start();
    expect(res.status).toBe(409);
    expect(errorBody(res).code).toBe('PERIOD_LOCKED');
  });

  it('does not start over an entry that ends slightly in the future', async () => {
    await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-31T09:00:00Z',
      endedAt: '2026-10-31T10:00:30Z',
    });
    const res = await start();
    expect(res.status).toBe(409);
    expect(errorBody(res).code).toBe('TIME_ENTRY_OVERLAP');
  });
});

describe('GET /timer and POST /timer/stop', () => {
  it('returns the running timer, then stops it at server time', async () => {
    expect(timerResponseSchema.parse((await s.as('workerA').get('/timer')).body).entry).toBeNull();
    await start();
    expect(
      timerResponseSchema.parse((await s.as('workerA').get('/timer')).body).entry?.endedAt,
    ).toBeNull();

    h.advance(90 * 60_000 + 15_000);
    const stopped = timerResponseSchema.parse(
      (await s.as('workerA').post('/timer/stop')).body,
    ).entry;
    expect(stopped).toMatchObject({
      endedAt: '2026-10-31T11:30:15.000Z',
      durationSeconds: 5415,
      source: 'TIMER',
    });
    expect(timerResponseSchema.parse((await s.as('workerA').get('/timer')).body).entry).toBeNull();
  });

  it('404s when no timer is running', async () => {
    expect((await s.as('workerA').post('/timer/stop')).status).toBe(404);
  });

  it('stopping right after starting still records one second', async () => {
    await start();
    const stopped = timerResponseSchema.parse(
      (await s.as('workerA').post('/timer/stop')).body,
    ).entry;
    expect(stopped?.durationSeconds).toBe(1);
  });

  it('caps a timer that ran past the org maximum and flags it as auto-stopped', async () => {
    await setOrgSettings({ maxTimerDurationSeconds: 12 * 3600 });
    await start();
    h.advance(13 * 3600_000);
    const stopped = timerResponseSchema.parse(
      (await s.as('workerA').post('/timer/stop')).body,
    ).entry;
    expect(stopped).toMatchObject({
      durationSeconds: 12 * 3600,
      source: 'AUTO_STOPPED',
      endedAt: '2026-10-31T22:00:00.000Z',
    });
  });

  it('timers of other users are not visible', async () => {
    await start();
    expect(timerResponseSchema.parse((await s.as('workerB').get('/timer')).body).entry).toBeNull();
    expect((await s.as('workerB').post('/timer/stop')).status).toBe(404);
  });

  it('deactivating a user stops their timer', async () => {
    await start();
    h.advance(3600_000);
    await s.as('admin').post(`/users/${s.users.workerA.id}/deactivate`);
    const [entry] = await entriesOf(s.users.workerA.id);
    expect(entry?.endedAt).not.toBeNull();
    expect(await prisma().timeEntry.count({ where: { endedAt: null } })).toBe(0);
  });
});
