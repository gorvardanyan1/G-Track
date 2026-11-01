import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { timeEntryResponseSchema } from '@tempo/shared';
import { z } from 'zod';
import { createHarness, prisma, resetDatabase, type Harness } from '../auth/harness.ts';
import { createScenario, type Scenario } from '../org/scenario.ts';
import { errorBody, insertEntry, setOrgSettings, setTimesheet, setTimezone } from './fixtures.ts';

let h: Harness;
let s: Scenario;
const entryList = z.array(timeEntryResponseSchema);

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  // Saturday 2026-10-31, 12:00 UTC. Europe/Berlin switched to winter time on 2026-10-25.
  h.setNow('2026-10-31T12:00:00Z');
  s = await createScenario(h);
});
afterAll(async () => {
  await prisma().$disconnect();
});

type Who = Parameters<Scenario['as']>[0];
const create = (
  who: Who,
  start: [string, string],
  end: [string, string],
  extra: Record<string, unknown> = {},
) =>
  s
    .as(who)
    .post('/time-entries')
    .send({
      projectId: who === 'workerB' ? s.projectB.id : s.projectA.id,
      description: 'Work',
      start: { date: start[0], time: start[1] },
      end: { date: end[0], time: end[1] },
      ...extra,
    });
const list = async (who: Who, from: string, to: string, userId?: string) => {
  const res = await s
    .as(who)
    .get(`/time-entries?from=${from}&to=${to}${userId ? `&userId=${userId}` : ''}`);
  return { res, entries: res.status === 200 ? entryList.parse(res.body) : [] };
};

describe('creating manual entries', () => {
  it('converts local times in the user’s timezone (Berlin, winter time)', async () => {
    const res = await create('workerA', ['2026-10-30', '09:00'], ['2026-10-30', '10:30']);
    expect(res.status).toBe(201);
    expect(timeEntryResponseSchema.parse(res.body)).toMatchObject({
      startedAt: '2026-10-30T08:00:00.000Z',
      endedAt: '2026-10-30T09:30:00.000Z',
      durationSeconds: 5400,
      source: 'MANUAL',
      editable: true,
    });
  });

  it('gives different instants for the same wall-clock input in different timezones', async () => {
    await setTimezone(s.users.workerA.id, 'Asia/Yerevan');
    await setTimezone(s.users.workerB.id, 'America/New_York');
    const yerevan = timeEntryResponseSchema.parse(
      (await create('workerA', ['2026-10-30', '09:00'], ['2026-10-30', '10:00'])).body,
    );
    const newYork = timeEntryResponseSchema.parse(
      (await create('workerB', ['2026-10-30', '09:00'], ['2026-10-30', '10:00'])).body,
    );
    expect(yerevan.startedAt).toBe('2026-10-30T05:00:00.000Z');
    expect(newYork.startedAt).toBe('2026-10-30T13:00:00.000Z');
  });

  it('supports entries crossing midnight', async () => {
    const entry = timeEntryResponseSchema.parse(
      (await create('workerA', ['2026-10-29', '22:30'], ['2026-10-30', '01:15'])).body,
    );
    expect(entry.durationSeconds).toBe(2 * 3600 + 45 * 60);
  });

  it('counts real elapsed time across the DST change (Berlin fall-back night)', async () => {
    const entry = timeEntryResponseSchema.parse(
      (await create('workerA', ['2026-10-25', '01:00'], ['2026-10-25', '04:00'])).body,
    );
    expect(entry.durationSeconds).toBe(4 * 3600);
  });

  it('rejects a wall-clock time skipped by DST with a clear message', async () => {
    await setTimezone(s.users.workerB.id, 'America/New_York');
    const res = await create('workerB', ['2026-03-08', '02:30'], ['2026-03-08', '04:00']);
    expect(res.status).toBe(400);
    expect(errorBody(res)).toMatchObject({
      code: 'INVALID_LOCAL_TIME',
      details: [
        {
          path: 'start',
          code: 'NONEXISTENT',
          message: expect.stringContaining('does not exist in America/New_York') as unknown,
        },
      ],
    });
  });

  it('asks which occurrence of an ambiguous time is meant, then accepts the choice', async () => {
    const res = await create('workerA', ['2026-10-25', '02:30'], ['2026-10-25', '05:00']);
    expect(res.status).toBe(400);
    expect(errorBody(res)).toMatchObject({
      code: 'INVALID_LOCAL_TIME',
      details: [
        {
          code: 'AMBIGUOUS',
          earlier: '2026-10-25T00:30:00.000Z',
          later: '2026-10-25T01:30:00.000Z',
        },
      ],
    });

    const later = await s
      .as('workerA')
      .post('/time-entries')
      .send({
        projectId: s.projectA.id,
        start: { date: '2026-10-25', time: '02:30', ambiguity: 'later' },
        end: { date: '2026-10-25', time: '05:00' },
      });
    expect(timeEntryResponseSchema.parse(later.body)).toMatchObject({
      startedAt: '2026-10-25T01:30:00.000Z',
      durationSeconds: 2.5 * 3600,
    });
  });

  it.each([
    ['end before start', ['2026-10-30', '10:00'], ['2026-10-30', '09:00'], 'END_NOT_AFTER_START'],
    ['zero length', ['2026-10-30', '10:00'], ['2026-10-30', '10:00'], 'END_NOT_AFTER_START'],
    ['longer than 24 h', ['2026-10-29', '09:00'], ['2026-10-30', '09:01'], 'TOO_LONG'],
    ['ending in the future', ['2026-10-31', '12:00'], ['2026-10-31', '13:02'], 'IN_FUTURE'],
  ] as const)('rejects %s', async (_label, start, end, issue) => {
    const res = await create('workerA', [...start], [...end]);
    expect(res.status).toBe(400);
    expect(errorBody(res)).toMatchObject({
      code: 'INVALID_TIME_RANGE',
      details: [{ code: issue }],
    });
  });

  it('tolerates up to one minute of clock skew into the future', async () => {
    // Now is 13:00 Berlin; an entry ending at 13:01 is within the tolerance.
    expect((await create('workerA', ['2026-10-31', '12:00'], ['2026-10-31', '13:01'])).status).toBe(
      201,
    );
  });

  it('only allows assigned, active projects and their own tasks', async () => {
    expect(
      (
        await create('workerA', ['2026-10-30', '09:00'], ['2026-10-30', '10:00'], {
          projectId: s.projectB.id,
        })
      ).status,
    ).toBe(404);
    expect(
      (await create('outsider', ['2026-10-30', '09:00'], ['2026-10-30', '10:00'])).status,
    ).toBe(404);
    expect(
      (
        await create('workerA', ['2026-10-30', '09:00'], ['2026-10-30', '10:00'], {
          taskId: s.taskB.id,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await create('workerA', ['2026-10-30', '09:00'], ['2026-10-30', '10:00'], {
          projectId: s.archived.id,
        })
      ).status,
    ).toBe(409);
  });

  it('audits manual entries', async () => {
    const entry = timeEntryResponseSchema.parse(
      (await create('workerA', ['2026-10-30', '09:00'], ['2026-10-30', '10:00'])).body,
    );
    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'time_entry.created' },
    });
    expect(audit).toMatchObject({
      actorId: s.users.workerA.id,
      targetId: entry.id,
      after: { durationSeconds: 3600 },
    });
  });
});

describe('overlaps', () => {
  beforeEach(async () => {
    await create('workerA', ['2026-10-30', '09:00'], ['2026-10-30', '11:00'], {
      description: 'Standup prep',
    });
  });

  it('rejects an overlapping entry, naming the conflict in local time', async () => {
    const res = await create('workerA', ['2026-10-30', '10:30'], ['2026-10-30', '12:00']);
    expect(res.status).toBe(409);
    expect(errorBody(res)).toMatchObject({
      code: 'TIME_ENTRY_OVERLAP',
      message: 'Overlaps “Standup prep” (2026-10-30 09:00–11:00)',
      details: { startedAt: '2026-10-30T08:00:00.000Z', endedAt: '2026-10-30T10:00:00.000Z' },
    });
  });

  it('allows back-to-back entries', async () => {
    expect((await create('workerA', ['2026-10-30', '11:00'], ['2026-10-30', '12:00'])).status).toBe(
      201,
    );
    expect((await create('workerA', ['2026-10-30', '08:00'], ['2026-10-30', '09:00'])).status).toBe(
      201,
    );
  });

  it('rejects entries overlapping the running timer', async () => {
    await s.as('workerA').post('/timer/start').send({ projectId: s.projectA.id });
    // The timer started at 13:00 Berlin (now); this entry ends at 13:01, inside the 1-min tolerance.
    const res = await create('workerA', ['2026-10-31', '12:30'], ['2026-10-31', '13:01']);
    expect(errorBody(res)).toMatchObject({
      code: 'TIME_ENTRY_OVERLAP',
      message: expect.stringContaining('the timer running since 2026-10-31 13:00') as unknown,
    });
  });

  it('lets only one of two concurrent overlapping entries in', async () => {
    const results = await Promise.all([
      create('workerA', ['2026-10-30', '14:00'], ['2026-10-30', '15:00']),
      create('workerA', ['2026-10-30', '14:30'], ['2026-10-30', '15:30']),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(errorBody(results.find((r) => r.status === 409)!).code).toBe('TIME_ENTRY_OVERLAP');
  });
});

describe('locked periods', () => {
  it('locks entries older than the org limit', async () => {
    await setOrgSettings({ lockAfterDays: 30 });
    expect((await create('workerA', ['2026-10-01', '09:00'], ['2026-10-01', '10:00'])).status).toBe(
      201,
    );
    const res = await create('workerA', ['2026-09-30', '09:00'], ['2026-09-30', '10:00']);
    expect(res.status).toBe(409);
    expect(errorBody(res).code).toBe('PERIOD_LOCKED');
  });

  it('blocks edits and deletes of entries in a locked period, and lists them as not editable', async () => {
    const old = await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-09-15T08:00:00Z',
      endedAt: '2026-09-15T09:00:00Z',
    });
    await setOrgSettings({ lockAfterDays: 30 });
    expect(
      errorBody(await s.as('workerA').patch(`/time-entries/${old.id}`).send({ description: 'x' }))
        .code,
    ).toBe('PERIOD_LOCKED');
    expect(errorBody(await s.as('workerA').delete(`/time-entries/${old.id}`)).code).toBe(
      'PERIOD_LOCKED',
    );
    const { entries } = await list('workerA', '2026-09-15', '2026-09-15');
    expect(entries[0]?.editable).toBe(false);
  });

  it('cannot move a recent entry into a locked period', async () => {
    await setOrgSettings({ lockAfterDays: 30 });
    const entry = timeEntryResponseSchema.parse(
      (await create('workerA', ['2026-10-30', '09:00'], ['2026-10-30', '10:00'])).body,
    );
    const res = await s
      .as('workerA')
      .patch(`/time-entries/${entry.id}`)
      .send({
        start: { date: '2026-09-01', time: '09:00' },
        end: { date: '2026-09-01', time: '10:00' },
      });
    expect(errorBody(res).code).toBe('PERIOD_LOCKED');
  });

  it.each(['SUBMITTED', 'APPROVED'] as const)(
    'blocks a week whose timesheet is %s',
    async (status) => {
      await setTimesheet(s.users.workerA.id, '2026-10-26', status);
      expect(
        errorBody(await create('workerA', ['2026-10-27', '09:00'], ['2026-10-27', '10:00'])).code,
      ).toBe('PERIOD_LOCKED');
      // The previous week is unaffected.
      expect(
        (await create('workerA', ['2026-10-23', '09:00'], ['2026-10-23', '10:00'])).status,
      ).toBe(201);
    },
  );

  it('allows changes again once a timesheet is rejected', async () => {
    await setTimesheet(s.users.workerA.id, '2026-10-26', 'REJECTED');
    expect((await create('workerA', ['2026-10-27', '09:00'], ['2026-10-27', '10:00'])).status).toBe(
      201,
    );
  });

  it('uses the user’s own timezone for the week (Sunday-night entry in New York)', async () => {
    await setTimezone(s.users.workerB.id, 'America/New_York');
    await setTimesheet(s.users.workerB.id, '2026-10-19', 'APPROVED');
    // Sunday 2026-10-25 22:00 New York is Monday 02:00 UTC, but still the approved week locally.
    expect(
      errorBody(await create('workerB', ['2026-10-25', '22:00'], ['2026-10-25', '23:00'])).code,
    ).toBe('PERIOD_LOCKED');
  });
});

describe('listing by range in the viewer’s timezone', () => {
  // One instant: Saturday 2026-10-31 20:30 UTC = Sunday 00:30 in Yerevan, Saturday 16:30 in New York.
  beforeEach(async () => {
    await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-31T20:30:00Z',
      endedAt: '2026-10-31T21:00:00Z',
    });
    h.setNow('2026-11-01T12:00:00Z');
  });

  it('puts the entry on Sunday for a Yerevan user and on Saturday for a New York user', async () => {
    await setTimezone(s.users.workerA.id, 'Asia/Yerevan');
    expect((await list('workerA', '2026-11-01', '2026-11-01')).entries).toHaveLength(1);
    expect((await list('workerA', '2026-10-31', '2026-10-31')).entries).toHaveLength(0);

    await setTimezone(s.users.workerA.id, 'America/New_York');
    expect((await list('workerA', '2026-10-31', '2026-10-31')).entries).toHaveLength(1);
    expect((await list('workerA', '2026-11-01', '2026-11-01')).entries).toHaveLength(0);
  });

  it('includes a midnight-crossing entry on both days', async () => {
    await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-29T21:30:00Z',
      endedAt: '2026-10-30T00:30:00Z',
    });
    expect((await list('workerA', '2026-10-29', '2026-10-29')).entries).toHaveLength(1);
    expect((await list('workerA', '2026-10-30', '2026-10-30')).entries).toHaveLength(1);
  });

  it('includes the running timer', async () => {
    await s.as('workerA').post('/timer/start').send({ projectId: s.projectA.id });
    const { entries } = await list('workerA', '2026-11-01', '2026-11-01');
    expect(entries.some((e) => e.endedAt === null)).toBe(true);
  });

  it('validates the range', async () => {
    expect((await list('workerA', '2026-11-02', '2026-11-01')).res.status).toBe(400);
    expect((await list('workerA', '2026-01-01', '2026-11-01')).res.status).toBe(400);
  });

  it('admins can list anyone; PMs only their workers on their projects; workers only themselves', async () => {
    await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.archived.id,
      startedAt: '2026-10-30T08:00:00Z',
      endedAt: '2026-10-30T09:00:00Z',
    });
    await prisma().project.update({
      where: { id: s.archived.id },
      data: {
        members: {
          delete: { projectId_userId: { projectId: s.archived.id, userId: s.users.pmA.id } },
        },
      },
    });

    const admin = await list('admin', '2026-10-30', '2026-11-01', s.users.workerA.id);
    expect(admin.entries).toHaveLength(2);
    expect(admin.entries.every((e) => !e.editable)).toBe(true);

    const pm = await list('pmA', '2026-10-30', '2026-11-01', s.users.workerA.id);
    expect(pm.entries.map((e) => e.projectId)).toEqual([s.projectA.id]);

    expect((await list('pmA', '2026-10-30', '2026-11-01', s.users.workerB.id)).res.status).toBe(
      404,
    );
    expect((await list('workerB', '2026-10-30', '2026-11-01', s.users.workerA.id)).res.status).toBe(
      404,
    );
  });
});

describe('updating, deleting and duplicating', () => {
  let entryId: string;
  beforeEach(async () => {
    entryId = timeEntryResponseSchema.parse(
      (
        await create('workerA', ['2026-10-30', '09:00'], ['2026-10-30', '10:00'], {
          taskId: s.taskA.id,
        })
      ).body,
    ).id;
  });

  it('the owner can change details and times; the edit is audited with before/after', async () => {
    const res = await s
      .as('workerA')
      .patch(`/time-entries/${entryId}`)
      .send({ description: 'Wireframes', end: { date: '2026-10-30', time: '10:45' } });
    expect(timeEntryResponseSchema.parse(res.body)).toMatchObject({
      description: 'Wireframes',
      durationSeconds: 6300,
    });
    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'time_entry.updated' },
    });
    expect(audit).toMatchObject({
      actorId: s.users.workerA.id,
      before: { description: 'Work', durationSeconds: 3600 },
      after: { description: 'Wireframes', durationSeconds: 6300 },
    });
  });

  it('rejects an update that would overlap another entry', async () => {
    await create('workerA', ['2026-10-30', '11:00'], ['2026-10-30', '12:00']);
    const res = await s
      .as('workerA')
      .patch(`/time-entries/${entryId}`)
      .send({ end: { date: '2026-10-30', time: '11:30' } });
    expect(errorBody(res).code).toBe('TIME_ENTRY_OVERLAP');
  });

  it('only the owner can edit: other workers get 404, admins and the PM 403', async () => {
    expect(
      (await s.as('workerB').patch(`/time-entries/${entryId}`).send({ description: 'x' })).status,
    ).toBe(404);
    expect((await s.as('outsider').delete(`/time-entries/${entryId}`)).status).toBe(404);
    expect((await s.as('pmB').get(`/time-entries/${entryId}`)).status).toBe(404);
    expect(
      (await s.as('admin').patch(`/time-entries/${entryId}`).send({ description: 'x' })).status,
    ).toBe(403);
    expect(
      (await s.as('pmA').patch(`/time-entries/${entryId}`).send({ description: 'x' })).status,
    ).toBe(403);
    expect((await s.as('pmA').delete(`/time-entries/${entryId}`)).status).toBe(403);
    expect(
      timeEntryResponseSchema.parse((await s.as('pmA').get(`/time-entries/${entryId}`)).body)
        .editable,
    ).toBe(false);
  });

  it('moving to another project clears the task and requires assignment', async () => {
    const other = await prisma().project.create({
      data: {
        name: 'Other',
        color: '#000000',
        members: { create: { userId: s.users.workerA.id, roleInProject: 'WORKER' } },
      },
    });
    const res = await s
      .as('workerA')
      .patch(`/time-entries/${entryId}`)
      .send({ projectId: other.id });
    expect(timeEntryResponseSchema.parse(res.body)).toMatchObject({
      projectId: other.id,
      taskId: null,
    });
    expect(
      (await s.as('workerA').patch(`/time-entries/${entryId}`).send({ projectId: s.projectB.id }))
        .status,
    ).toBe(404);
  });

  it('a running timer can be edited, but not given an end', async () => {
    const running = await s.as('workerA').post('/timer/start').send({ projectId: s.projectA.id });
    const id = (running.body as { entry: { id: string } }).entry.id;
    expect(
      (await s.as('workerA').patch(`/time-entries/${id}`).send({ description: 'Live' })).status,
    ).toBe(200);
    expect(
      (
        await s
          .as('workerA')
          .patch(`/time-entries/${id}`)
          .send({ end: { date: '2026-10-31', time: '13:30' } })
      ).status,
    ).toBe(400);
  });

  it('deletes and audits the deleted values', async () => {
    expect((await s.as('workerA').delete(`/time-entries/${entryId}`)).status).toBe(204);
    expect((await s.as('workerA').get(`/time-entries/${entryId}`)).status).toBe(404);
    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'time_entry.deleted' },
    });
    expect(audit).toMatchObject({
      targetId: entryId,
      before: { description: 'Work', durationSeconds: 3600 },
    });
  });

  it('duplicates to another day at the same local times, keeping project and task', async () => {
    const res = await s
      .as('workerA')
      .post(`/time-entries/${entryId}/duplicate`)
      .send({ date: '2026-10-29' });
    expect(res.status).toBe(201);
    expect(timeEntryResponseSchema.parse(res.body)).toMatchObject({
      startedAt: '2026-10-29T08:00:00.000Z',
      durationSeconds: 3600,
      taskId: s.taskA.id,
    });
  });

  it('duplicates into today by default and keeps local times across the DST change', async () => {
    // Original on 2026-10-23 (summer time, UTC+2) at 09:00; today is 2026-10-31 (winter time, UTC+1).
    const summer = timeEntryResponseSchema.parse(
      (await create('workerA', ['2026-10-23', '09:00'], ['2026-10-23', '10:00'])).body,
    );
    expect(summer.startedAt).toBe('2026-10-23T07:00:00.000Z');
    const copy = timeEntryResponseSchema.parse(
      (await s.as('workerA').post(`/time-entries/${summer.id}/duplicate`).send({})).body,
    );
    expect(copy.startedAt).toBe('2026-10-31T08:00:00.000Z');
  });

  it('refuses to duplicate onto an overlapping slot', async () => {
    const res = await s
      .as('workerA')
      .post(`/time-entries/${entryId}/duplicate`)
      .send({ date: '2026-10-30' });
    expect(errorBody(res).code).toBe('TIME_ENTRY_OVERLAP');
  });
});
