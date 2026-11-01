import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  reportResponseSchema,
  timesheetResponseSchema,
  timesheetSummarySchema,
} from '@tempo/shared';
import { z } from 'zod';
import { createHarness, prisma, resetDatabase, type Harness } from '../auth/harness.ts';
import { createScenario, type Scenario } from '../org/scenario.ts';
import { errorBody, insertEntry } from '../tracking/fixtures.ts';

let h: Harness;
let s: Scenario;
type Who = Parameters<Scenario['as']>[0];

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  // Saturday 31 Oct 2026, 13:00 in Berlin. Last week: Mon 19 – Sun 25 October.
  h.setNow('2026-10-31T12:00:00Z');
  s = await createScenario(h);
});
afterAll(async () => {
  await prisma().$disconnect();
});

const submit = (who: Who, week = '2026-10-19') =>
  s.as(who).post('/timesheets/submit').send({ week });
const sheet = async (who: Who, id: string) =>
  timesheetResponseSchema.parse((await s.as(who).get(`/timesheets/${id}`)).body);
const approve = (who: Who, id: string) => s.as(who).post(`/timesheets/${id}/approve`).send({});
const reject = (who: Who, id: string, comment: string) =>
  s.as(who).post(`/timesheets/${id}/reject`).send({ comment });

describe('an approved week is fixed (blocker: timezone change)', () => {
  it('a later profile timezone change can’t unlock, move or change its time', async () => {
    // Sun 25 Oct 22:00–23:00 in Berlin (CET): last day of the week.
    const sunday = await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-25T21:00:00Z',
      endedAt: '2026-10-25T22:00:00Z',
    });
    const outside = await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-27T08:00:00Z',
      endedAt: '2026-10-27T09:00:00Z',
    });
    const res = await submit('workerA');
    const id = timesheetResponseSchema.parse(res.body).id!;
    expect((await approve('pmA', id)).status).toBe(200);
    expect((await sheet('workerA', id)).status).toBe('APPROVED');

    // In Kiritimati (UTC+14) that entry is Monday 26 Oct: next week, by local dates.
    expect(
      (await s.as('workerA').patch('/auth/me').send({ timezone: 'Pacific/Kiritimati' })).status,
    ).toBe(200);
    expect(errorBody(await s.as('workerA').delete(`/time-entries/${sunday.id}`)).code).toBe(
      'PERIOD_LOCKED',
    );
    // Nor can other time be moved or added into the approved period.
    const moved = await s
      .as('workerA')
      .patch(`/time-entries/${outside.id}`)
      .send({
        start: { date: '2026-10-26', time: '06:00' },
        end: { date: '2026-10-26', time: '07:00' },
      });
    expect(errorBody(moved).code).toBe('PERIOD_LOCKED');

    // The approved week keeps its timezone, days and total.
    const after = await sheet('pmA', id);
    expect(after).toMatchObject({ timezone: 'Europe/Berlin', totalSeconds: 3600 });
    expect(after.dayTotals).toEqual([0, 0, 0, 0, 0, 0, 3600]);
  });

  it('two locked weeks can never overlap, even if the week start day changes', async () => {
    expect((await submit('workerA')).status).toBe(200); // Mon 19 – Sun 25
    await prisma().orgSettings.upsert({
      where: { id: 1 },
      create: { id: 1, name: 'Org', defaultTimezone: 'UTC', weekStartDay: 7 },
      update: { weekStartDay: 7 },
    });
    // Sun 18 – Sat 24 overlaps the submitted week.
    expect(errorBody(await submit('workerA', '2026-10-20'))).toMatchObject({
      code: 'TIMESHEET_NOT_SUBMITTABLE',
      message: 'This week overlaps a week that is already submitted or approved',
    });
  });
});

describe('each project’s PM approves their part (blocker: one PM approving everything)', () => {
  /** workerA also works on pmB's Project B; time on both projects last week. */
  async function twoProjectWeek() {
    await prisma().projectMember.create({
      data: {
        projectId: s.projectB.id,
        userId: s.users.workerA.id,
        roleInProject: 'WORKER',
        hourlyRate: 90,
      },
    });
    await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-20T08:00:00Z',
      endedAt: '2026-10-20T10:00:00Z',
    });
    await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectB.id,
      startedAt: '2026-10-21T08:00:00Z',
      endedAt: '2026-10-21T09:00:00Z',
    });
    const res = await submit('workerA');
    expect(res.status).toBe(200);
    return timesheetResponseSchema.parse(res.body).id!;
  }
  const pending = async (who: Who) =>
    z
      .object({ items: z.array(timesheetSummarySchema) })
      .parse((await s.as(who).get('/timesheets?status=SUBMITTED&reviewable=true')).body)
      .items.map((i) => i.user.name);

  it('a PM decides only their project; the week is approved when every part is', async () => {
    const id = await twoProjectWeek();
    const forA = await sheet('pmA', id);
    expect(
      forA.reviews.map((r) => [
        r.project?.name ?? null,
        r.visible,
        r.status,
        r.seconds,
        r.canReview,
      ]),
    ).toEqual([
      ['Project A', true, 'PENDING', 7200, true],
      // Project B is pmB's: no name, no reviewer, not pmA's to decide.
      [null, false, 'PENDING', 3600, false],
    ]);
    expect(forA.reviews[1]?.reviewer).toBeNull();

    expect((await approve('pmA', id)).status).toBe(200);
    expect((await sheet('workerA', id)).status).toBe('SUBMITTED'); // still waiting for pmB
    // pmA has nothing left to decide; pmB has.
    expect(await pending('pmA')).toEqual([]);
    expect(await pending('pmB')).toEqual(['Anahit Worker']);
    expect((await approve('pmA', id)).status).toBe(403);
    // Still locked while part of it is pending.
    const locked = await s
      .as('workerA')
      .post('/time-entries')
      .send({
        projectId: s.projectA.id,
        start: { date: '2026-10-22', time: '09:00' },
        end: { date: '2026-10-22', time: '10:00' },
      });
    expect(errorBody(locked).code).toBe('PERIOD_LOCKED');

    expect((await approve('pmB', id)).status).toBe(200);
    const done = await sheet('workerA', id);
    expect(done.status).toBe('APPROVED');
    expect(done.reviews.map((r) => [r.project?.name, r.status, r.reviewer?.name])).toEqual([
      ['Project A', 'APPROVED', 'Petra PM'],
      ['Project B', 'APPROVED', 'Marcus PM'],
    ]);
  });

  it('one returned part returns the whole week; resubmitting reopens every part', async () => {
    const id = await twoProjectWeek();
    expect((await approve('pmA', id)).status).toBe(200);
    expect((await reject('pmB', id, 'Wednesday on B looks short')).status).toBe(200);
    const returned = await sheet('workerA', id);
    expect(returned).toMatchObject({ status: 'REJECTED', comment: 'Wednesday on B looks short' });
    expect(returned.reviews.map((r) => r.status)).toEqual(['APPROVED', 'REJECTED']);

    // Editable again, and a resubmission is reviewed from scratch.
    const added = await s
      .as('workerA')
      .post('/time-entries')
      .send({
        projectId: s.projectB.id,
        start: { date: '2026-10-21', time: '13:00' },
        end: { date: '2026-10-21', time: '14:00' },
      });
    expect(added.status).toBe(201);
    expect((await submit('workerA')).status).toBe(200);
    const again = await sheet('workerA', id);
    expect(again.reviews.map((r) => [r.status, r.seconds])).toEqual([
      ['PENDING', 7200],
      ['PENDING', 7200],
    ]);
  });

  it('a Super Admin approves every part at once; parallel approvals end approved', async () => {
    const id = await twoProjectWeek();
    expect((await approve('admin', id)).status).toBe(200);
    expect((await sheet('workerA', id)).status).toBe('APPROVED');

    // Second week, both PMs at the same moment.
    await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-13T08:00:00Z',
      endedAt: '2026-10-13T09:00:00Z',
    });
    await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectB.id,
      startedAt: '2026-10-14T08:00:00Z',
      endedAt: '2026-10-14T09:00:00Z',
    });
    const second = timesheetResponseSchema.parse((await submit('workerA', '2026-10-12')).body).id!;
    const [a, b] = await Promise.all([approve('pmA', second), approve('pmB', second)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect((await sheet('workerA', second)).status).toBe('APPROVED');
  });

  it('a week without time has one whole-week part for the worker’s PM', async () => {
    const res = await submit('workerA');
    const body = timesheetResponseSchema.parse(res.body);
    expect(body.reviews).toEqual([
      expect.objectContaining({ project: null, visible: true, seconds: 0 }),
    ]);
    expect((await approve('pmB', body.id!)).status).toBe(404); // not pmB's worker
    expect((await approve('pmA', body.id!)).status).toBe(200);
    expect((await sheet('workerA', body.id!)).status).toBe('APPROVED');
  });
});

describe('rates are kept per entry (blocker: rate changes rewriting past billing)', () => {
  const amountOn = async (date: string) => {
    const res = await s.as('pmA').get(`/reports?from=${date}&to=${date}`);
    return reportResponseSchema.parse(res.body).totals.amountCents;
  };

  it('a new rate applies to time tracked from then on, never to the past', async () => {
    // workerA's rate on Project A is 80/h.
    await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-26T08:00:00Z',
      endedAt: '2026-10-26T09:00:00Z',
    });
    expect(await amountOn('2026-10-26')).toBe(8000);

    const raised = await s
      .as('pmA')
      .put(`/projects/${s.projectA.id}/members/${s.users.workerA.id}`)
      .send({ roleInProject: 'WORKER', hourlyRate: 100 });
    expect(raised.status).toBe(200);
    expect(await amountOn('2026-10-26')).toBe(8000); // unchanged

    const tuesday = await s
      .as('workerA')
      .post('/time-entries')
      .send({
        projectId: s.projectA.id,
        start: { date: '2026-10-27', time: '09:00' },
        end: { date: '2026-10-27', time: '10:00' },
      });
    expect(tuesday.status).toBe(201);
    expect(await amountOn('2026-10-27')).toBe(10_000);
  });

  it('moving an entry to another project takes that project’s rate', async () => {
    await prisma().projectMember.create({
      data: {
        projectId: s.projectB.id,
        userId: s.users.workerA.id,
        roleInProject: 'WORKER',
        hourlyRate: 90,
      },
    });
    const entry = await insertEntry({
      userId: s.users.workerA.id,
      projectId: s.projectA.id,
      startedAt: '2026-10-28T08:00:00Z',
      endedAt: '2026-10-28T09:00:00Z',
    });
    expect(
      (
        await prisma().timeEntry.findUniqueOrThrow({ where: { id: entry.id } })
      ).hourlyRate?.toNumber(),
    ).toBe(80);
    await s.as('workerA').patch(`/time-entries/${entry.id}`).send({ projectId: s.projectB.id });
    expect(
      (
        await prisma().timeEntry.findUniqueOrThrow({ where: { id: entry.id } })
      ).hourlyRate?.toNumber(),
    ).toBe(90);
    // Other edits keep the stored rate, even after the member's rate changed.
    await prisma().projectMember.update({
      where: { projectId_userId: { projectId: s.projectB.id, userId: s.users.workerA.id } },
      data: { hourlyRate: 120 },
    });
    await s.as('workerA').patch(`/time-entries/${entry.id}`).send({ description: 'renamed' });
    expect(
      (
        await prisma().timeEntry.findUniqueOrThrow({ where: { id: entry.id } })
      ).hourlyRate?.toNumber(),
    ).toBe(90);
  });
});
