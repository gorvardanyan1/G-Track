import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { timesheetResponseSchema, timesheetSummarySchema } from '@tempo/shared';
import { z } from 'zod';
import {
  auditActions,
  createHarness,
  prisma,
  resetDatabase,
  type Harness,
} from '../auth/harness.ts';
import { createScenario, type Scenario } from '../org/scenario.ts';
import { errorBody, insertEntry, setOrgSettings } from '../tracking/fixtures.ts';

let h: Harness;
let s: Scenario;

/** workerA's entries (Berlin; CEST until Oct 25, CET after). */
let entries: Awaited<ReturnType<typeof insertEntry>>[];

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  // Saturday 2026-10-31, 13:00 in Berlin. The previous week is Mon 19 – Sun 25 October.
  h.setNow('2026-10-31T12:00:00Z');
  s = await createScenario(h);
  const a = s.users.workerA.id;
  entries = [
    // 22:00–02:00 local, Wed→Thu: 2 h on each day.
    await insertEntry({
      userId: a,
      projectId: s.projectA.id,
      startedAt: '2026-10-21T20:00:00Z',
      endedAt: '2026-10-22T00:00:00Z',
    }),
    // Sun 25 Oct 23:30 – Mon 26 Oct 00:30 (CET): half in each week.
    await insertEntry({
      userId: a,
      projectId: s.projectA.id,
      startedAt: '2026-10-25T22:30:00Z',
      endedAt: '2026-10-25T23:30:00Z',
    }),
    // Tuesday of the current week.
    await insertEntry({
      userId: a,
      projectId: s.projectA.id,
      startedAt: '2026-10-27T08:00:00Z',
      endedAt: '2026-10-27T09:00:00Z',
    }),
  ];
});
afterAll(async () => {
  await prisma().$disconnect();
});

type Who = Parameters<Scenario['as']>[0];
const mine = async (who: Who, week: string) => {
  const res = await s.as(who).get(`/timesheets/me?week=${week}`);
  expect(res.status).toBe(200);
  return timesheetResponseSchema.parse(res.body);
};
const submit = (who: Who, week: string) => s.as(who).post('/timesheets/submit').send({ week });
const submitted = async (who: Who, week: string) => {
  const res = await submit(who, week);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return timesheetResponseSchema.parse(res.body);
};
const approve = (who: Who, id: string, comment?: string) =>
  s
    .as(who)
    .post(`/timesheets/${id}/approve`)
    .send(comment ? { comment } : {});
const reject = (who: Who, id: string, comment: string) =>
  s.as(who).post(`/timesheets/${id}/reject`).send({ comment });
const editEntry = (id: string) =>
  s.as('workerA').patch(`/time-entries/${id}`).send({ description: 'changed' });

describe('the week grid', () => {
  it('is a DRAFT until submitted and splits entries by local day in the owner’s timezone', async () => {
    const sheet = await mine('workerA', '2026-10-22');
    expect(sheet).toMatchObject({
      id: null,
      status: 'DRAFT',
      weekStart: '2026-10-19',
      weekEnd: '2026-10-25',
      timezone: 'Europe/Berlin',
      canReview: false,
    });
    expect(sheet.dates).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
    expect(sheet.dayTotals).toEqual([0, 0, 7200, 7200, 0, 0, 1800]);
    expect(sheet.totalSeconds).toBe(16_200);
    expect(sheet.projects).toEqual([
      {
        project: { id: s.projectA.id, name: 'Project A', color: '#5B5BF7' },
        seconds: [0, 0, 7200, 7200, 0, 0, 1800],
        totalSeconds: 16_200,
      },
    ]);
    // The other half of the Sunday-night entry belongs to the next week.
    expect((await mine('workerA', '2026-10-26')).dayTotals).toEqual([1800, 3600, 0, 0, 0, 0, 0]);
  });

  it('follows the org week start day', async () => {
    await setOrgSettings({ weekStartDay: 7 });
    const sheet = await mine('workerA', '2026-10-22');
    expect([sheet.weekStart, sheet.weekEnd]).toEqual(['2026-10-18', '2026-10-24']);
    expect(sheet.dayTotals).toEqual([0, 0, 0, 7200, 7200, 0, 0]);
  });
});

describe('submitting', () => {
  it('locks the week’s entries (and only those) and is audited', async () => {
    const sheet = await submitted('workerA', '2026-10-22');
    expect(sheet).toMatchObject({
      status: 'SUBMITTED',
      weekStart: '2026-10-19',
      submittedAt: '2026-10-31T12:00:00.000Z',
    });
    expect(sheet.id).not.toBeNull();

    expect(errorBody(await editEntry(entries[0]!.id)).code).toBe('PERIOD_LOCKED');
    // Touches the submitted week, so it is locked too.
    expect(errorBody(await editEntry(entries[1]!.id)).code).toBe('PERIOD_LOCKED');
    expect((await editEntry(entries[2]!.id)).status).toBe(200);
    const created = await s
      .as('workerA')
      .post('/time-entries')
      .send({
        projectId: s.projectA.id,
        start: { date: '2026-10-23', time: '09:00' },
        end: { date: '2026-10-23', time: '10:00' },
      });
    expect(errorBody(created).code).toBe('PERIOD_LOCKED');

    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'timesheet.submitted' },
    });
    expect(audit).toMatchObject({ actorId: s.users.workerA.id, targetId: sheet.id });
    expect(audit.after).toEqual({
      weekStart: '2026-10-19',
      weekEnd: '2026-10-25',
      totalSeconds: 16_200,
    });
  });

  it('rejects resubmission, future weeks, and weeks with a running timer', async () => {
    await submitted('workerA', '2026-10-19');
    expect(errorBody(await submit('workerA', '2026-10-25')).code).toBe('TIMESHEET_NOT_SUBMITTABLE');
    expect(errorBody(await submit('workerA', '2026-11-02')).code).toBe('TIMESHEET_NOT_SUBMITTABLE');

    expect(
      (await s.as('workerA').post('/timer/start').send({ projectId: s.projectA.id })).status,
    ).toBe(201);
    const running = await submit('workerA', '2026-10-31');
    expect(errorBody(running)).toMatchObject({
      code: 'TIMESHEET_NOT_SUBMITTABLE',
      message: 'Stop the running timer before submitting this week',
    });
    await s.as('workerA').post('/timer/stop');
    expect((await submit('workerA', '2026-10-31')).status).toBe(200);
  });

  it('blocks starting a timer in a submitted current week', async () => {
    await submitted('workerA', '2026-10-31');
    const res = await s.as('workerA').post('/timer/start').send({ projectId: s.projectA.id });
    expect(errorBody(res).code).toBe('PERIOD_LOCKED');
  });

  it('is refused while timesheet approval is turned off', async () => {
    await setOrgSettings({ timesheetApprovalEnabled: false });
    expect(errorBody(await submit('workerA', '2026-10-19')).code).toBe(
      'TIMESHEET_APPROVAL_DISABLED',
    );
  });

  it('validates the body', async () => {
    expect(
      (await s.as('workerA').post('/timesheets/submit').send({ week: '2026-13-01' })).status,
    ).toBe(400);
  });
});

describe('reviewing', () => {
  it('the PM approves with a comment; the week stays read-only, even if approval is turned off', async () => {
    const { id } = await submitted('workerA', '2026-10-19');
    const pending = await s.as('pmA').get(`/timesheets/${id}`);
    expect(timesheetResponseSchema.parse(pending.body).canReview).toBe(true);

    const res = await approve('pmA', id!, 'Looks good');
    expect(res.status).toBe(200);
    expect(timesheetResponseSchema.parse(res.body)).toMatchObject({
      status: 'APPROVED',
      reviewer: { id: s.users.pmA.id, name: 'Petra PM' },
      reviewedAt: '2026-10-31T12:00:00.000Z',
      comment: 'Looks good',
      canReview: false,
    });
    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'timesheet.approved' },
    });
    expect(audit).toMatchObject({ actorId: s.users.pmA.id, targetType: 'timesheet', targetId: id });
    expect(audit.before).toEqual({ status: 'SUBMITTED' });

    expect(errorBody(await editEntry(entries[0]!.id)).code).toBe('PERIOD_LOCKED');
    await setOrgSettings({ timesheetApprovalEnabled: false });
    expect(errorBody(await editEntry(entries[0]!.id)).code).toBe('PERIOD_LOCKED');
    expect(errorBody(await s.as('workerA').delete(`/time-entries/${entries[0]!.id}`)).code).toBe(
      'PERIOD_LOCKED',
    );
  });

  it('rejecting needs a comment, unlocks the week, and resubmitting clears the review', async () => {
    const { id } = await submitted('workerA', '2026-10-19');
    expect((await reject('pmA', id!, '   ')).status).toBe(400);
    const res = await reject('pmA', id!, 'Wednesday night looks wrong');
    expect(timesheetResponseSchema.parse(res.body)).toMatchObject({
      status: 'REJECTED',
      comment: 'Wednesday night looks wrong',
    });
    expect((await mine('workerA', '2026-10-19')).comment).toBe('Wednesday night looks wrong');
    expect((await editEntry(entries[0]!.id)).status).toBe(200);

    const again = await submitted('workerA', '2026-10-19');
    expect(again).toMatchObject({ id, status: 'SUBMITTED', reviewer: null, comment: null });
    expect(await auditActions()).toEqual(
      expect.arrayContaining(['timesheet.submitted', 'timesheet.rejected', 'time_entry.updated']),
    );
  });

  it('only a pending timesheet can be reviewed, and only once under concurrency', async () => {
    const { id } = await submitted('workerA', '2026-10-19');
    const results = await Promise.all([approve('pmA', id!), reject('admin', id!, 'No')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(errorBody(results.find((r) => r.status === 409)!).code).toBe('TIMESHEET_NOT_PENDING');
    expect(errorBody(await approve('pmA', id!)).code).toBe('TIMESHEET_NOT_PENDING');
    expect(await prisma().auditLog.count({ where: { action: { startsWith: 'timesheet.' } } })).toBe(
      2,
    );
  });

  it('a PM reviewing a worker on several projects sees other projects only as a total', async () => {
    await prisma().projectMember.create({
      data: { projectId: s.projectB.id, userId: s.users.workerA.id, roleInProject: 'WORKER' },
    });
    await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectB.id,
      startedAt: '2026-10-20T08:00:00Z',
      endedAt: '2026-10-20T09:30:00Z',
    });
    const { id } = await submitted('workerA', '2026-10-19');

    const asPmA = timesheetResponseSchema.parse((await s.as('pmA').get(`/timesheets/${id}`)).body);
    expect(asPmA.projects.map((p) => p.project.name)).toEqual(['Project A']);
    expect(asPmA.otherSeconds).toEqual([0, 5400, 0, 0, 0, 0, 0]);
    expect(asPmA.totalSeconds).toBe(16_200 + 5400);

    const asOwner = await mine('workerA', '2026-10-19');
    expect(asOwner.projects.map((p) => p.project.name)).toEqual(['Project A', 'Project B']);
    expect(asOwner.otherSeconds).toEqual([0, 0, 0, 0, 0, 0, 0]);
    // pmB can now see and review workerA's week too.
    expect((await approve('pmB', id!)).status).toBe(200);
  });
});

describe('permissions', () => {
  it.each([
    ['pmB', 404],
    ['workerB', 404],
    ['outsider', 404],
    ['workerA', 403],
  ] as const)('%s approving workerA’s timesheet gets %i', async (who, status) => {
    const { id } = await submitted('workerA', '2026-10-19');
    expect((await approve(who, id!)).status).toBe(status);
    expect((await reject(who, id!, 'no')).status).toBe(status);
    if (status === 404) expect((await s.as(who).get(`/timesheets/${id}`)).status).toBe(404);
  });

  it('nobody reviews their own timesheet; the admin reviews a PM’s', async () => {
    const { id } = await submitted('pmA', '2026-10-19');
    expect((await approve('pmA', id!)).status).toBe(403);
    expect((await approve('admin', id!)).status).toBe(200);
  });

  it('lists only what each role may see', async () => {
    await submitted('workerA', '2026-10-19');
    await submitted('workerB', '2026-10-19');
    await submitted('pmA', '2026-10-19');
    const page = z.object({ items: z.array(timesheetSummarySchema), total: z.number() });
    const names = async (who: Who, q = '') =>
      page
        .parse((await s.as(who).get(`/timesheets?status=SUBMITTED${q}`)).body)
        .items.map((i) => i.user.name)
        .sort();

    expect(await names('admin')).toEqual(['Anahit Worker', 'Bob Worker', 'Petra PM']);
    expect(await names('pmA')).toEqual(['Anahit Worker', 'Petra PM']);
    expect(await names('pmB')).toEqual(['Bob Worker']);
    expect(await names('workerA')).toEqual(['Anahit Worker']);
    expect(await names('pmA', `&userId=${s.users.workerA.id}`)).toEqual(['Anahit Worker']);
    expect((await s.as('workerA').get(`/timesheets?userId=${s.users.workerB.id}`)).status).toBe(
      404,
    );
    expect((await s.as('pmA').get(`/timesheets?userId=${s.users.workerB.id}`)).status).toBe(404);

    const first = page.parse(
      (await s.as('pmA').get(`/timesheets?userId=${s.users.workerA.id}`)).body,
    ).items[0];
    expect(first).toMatchObject({
      weekStart: '2026-10-19',
      totalSeconds: 16_200,
      status: 'SUBMITTED',
    });
    expect(await names('admin', '&from=2026-10-20')).toEqual([]);
  });

  it('lists only what the caller may review with reviewable=true (never their own)', async () => {
    await submitted('workerA', '2026-10-19');
    await submitted('pmA', '2026-10-19');
    const page = z.object({ items: z.array(timesheetSummarySchema), total: z.number() });
    const names = async (who: Who, q = '') => {
      const res = await s.as(who).get(`/timesheets?status=SUBMITTED&reviewable=true${q}`);
      const body = page.parse(res.body);
      return { names: body.items.map((i) => i.user.name).sort(), total: body.total };
    };

    expect(await names('pmA')).toEqual({ names: ['Anahit Worker'], total: 1 });
    expect(await names('admin')).toEqual({ names: ['Anahit Worker', 'Petra PM'], total: 2 });
    expect(await names('workerA')).toEqual({ names: [], total: 0 });
    expect(await names('pmA', `&userId=${s.users.pmA.id}`)).toEqual({ names: [], total: 0 });
  });

  it('requires authentication; unknown or malformed ids are 404', async () => {
    expect((await h.api().get('/timesheets/me?week=2026-10-19')).status).toBe(401);
    expect(
      (await s.as('admin').get('/timesheets/0190e5b2-0000-7000-8000-000000000000')).status,
    ).toBe(404);
    expect((await s.as('admin').get('/timesheets/nope')).status).toBe(404);
  });
});
