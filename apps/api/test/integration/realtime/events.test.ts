import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activitySnapshotEventSchema,
  activityUpdateEventSchema,
  entrySavedEventSchema,
  UserRole,
  type ActivityUpdateEvent,
  type EntrySavedEvent,
} from '@tempo/shared';
import { createJobs } from '../../../src/jobs.ts';
import { prisma } from '../auth/harness.ts';
import { insertEntry } from '../tracking/fixtures.ts';
import { settle } from './client.ts';
import { join, roomsOf, setUp, tearDown, type RealtimeFixture } from './fixture.ts';

let f: RealtimeFixture;

beforeEach(async () => {
  f = await setUp();
});
afterEach(async () => {
  await tearDown(f);
});
afterAll(async () => {
  await prisma().$disconnect();
});

const startTimer = (who: 'workerA' | 'workerB' | 'pmA', projectId: string, description = '') =>
  f.s.as(who).post('/timer/start').send({ projectId, description });
const saved = (action: EntrySavedEvent['action']) => (e: EntrySavedEvent) => e.action === action;
const about = (userId: string) => (e: ActivityUpdateEvent) => e.user.id === userId;

describe('a user’s tabs and devices stay in sync', () => {
  it('timer start and stop reach every tab of the user, and nobody else', async () => {
    const tab1 = await join(f, 'workerA');
    const tab2 = await join(f, 'workerA');
    const stranger = await join(f, 'workerB');

    expect((await startTimer('workerA', f.s.projectA.id, 'Wireframes')).status).toBe(201);
    for (const tab of [tab1, tab2]) {
      const event = entrySavedEventSchema.parse(
        await tab.next<EntrySavedEvent>('entry:saved', saved('timer_started')),
      );
      expect(event.entry).toMatchObject({
        description: 'Wireframes',
        endedAt: null,
        editable: true,
      });
      expect(event.serverTime).toBe('2026-10-31T12:00:00.000Z');
    }

    f.h.advance(90_000);
    expect((await f.s.as('workerA').post('/timer/stop')).status).toBe(200);
    for (const tab of [tab1, tab2]) {
      const event = await tab.next<EntrySavedEvent>('entry:saved', saved('timer_stopped'));
      expect(event.entry.durationSeconds).toBe(90);
    }
    await settle();
    expect(stranger.received).toEqual([]);
  });

  it('starting while another timer runs sends the stopped one too', async () => {
    const tab = await join(f, 'workerA');
    await startTimer('workerA', f.s.projectA.id, 'first');
    f.h.advance(60_000);
    await startTimer('workerA', f.s.projectA.id, 'second');
    const stopped = await tab.next<EntrySavedEvent>('entry:saved', saved('timer_stopped'));
    expect(stopped.entry).toMatchObject({ description: 'first', durationSeconds: 60 });
    await tab.next<EntrySavedEvent>('entry:saved', (e) => e.entry.description === 'second');
  });

  it('manual entries: created, updated, deleted', async () => {
    const tab = await join(f, 'workerA');
    const created = await f.s
      .as('workerA')
      .post('/time-entries')
      .send({
        projectId: f.s.projectA.id,
        description: 'Notes',
        start: { date: '2026-10-30', time: '09:00' },
        end: { date: '2026-10-30', time: '10:00' },
      });
    const id = (created.body as { id: string }).id;
    await tab.next<EntrySavedEvent>(
      'entry:saved',
      (e) => e.action === 'created' && e.entry.id === id,
    );

    await f.s.as('workerA').patch(`/time-entries/${id}`).send({ description: 'Edited' });
    const updated = await tab.next<EntrySavedEvent>('entry:saved', saved('updated'));
    expect(updated.entry.description).toBe('Edited');

    await f.s.as('workerA').delete(`/time-entries/${id}`);
    expect(await tab.next('entry:deleted')).toMatchObject({ id });
  });

  it('timesheet status changes reach the owner', async () => {
    const tab = await join(f, 'workerA');
    const submitted = await f.s
      .as('workerA')
      .post('/timesheets/submit')
      .send({ week: '2026-10-21' });
    const id = (submitted.body as { id: string }).id;
    expect(await tab.next('timesheet:changed')).toMatchObject({
      id,
      weekStart: '2026-10-19',
      status: 'SUBMITTED',
    });
    await f.s.as('pmA').post(`/timesheets/${id}/approve`).send({});
    await tab.next<{ status: string }>('timesheet:changed', (e) => e.status === 'APPROVED');
  });
});

describe('live “working now” for PMs and admins', () => {
  it('a PM sees only activity on their projects; the admin sees all; workers see none', async () => {
    const pmA = await join(f, 'pmA');
    const pmB = await join(f, 'pmB');
    const admin = await join(f, 'admin');
    const workerB = await join(f, 'workerB');

    await startTimer('workerA', f.s.projectA.id, 'Mockups');
    const seen = activityUpdateEventSchema.parse(
      await pmA.next('activity:update', about(f.s.users.workerA.id)),
    );
    expect(seen.running).toMatchObject({
      project: { id: f.s.projectA.id, name: 'Project A' },
      description: 'Mockups',
      startedAt: '2026-10-31T12:00:00.000Z',
    });
    expect(seen.user).toEqual({ id: f.s.users.workerA.id, name: 'Anahit Worker' });
    await admin.next<ActivityUpdateEvent>('activity:update', (e) => e.running !== null);
    await settle();
    expect(pmB.all('activity:update')).toEqual([]);
    expect(workerB.all('activity:update')).toEqual([]);
    // No rates or amounts in activity payloads.
    expect(JSON.stringify(pmA.received)).not.toMatch(/rate|amount/i);

    f.h.advance(60_000);
    await f.s.as('workerA').post('/timer/stop');
    await pmA.next<ActivityUpdateEvent>('activity:update', (e) => e.running === null);
  });

  it('switching projects: the old project’s PM sees "stopped", the new one sees the timer', async () => {
    await prisma().projectMember.create({
      data: { projectId: f.s.projectB.id, userId: f.s.users.workerA.id, roleInProject: 'WORKER' },
    });
    const pmA = await join(f, 'pmA');
    const pmB = await join(f, 'pmB');
    const admin = await join(f, 'admin');

    await startTimer('workerA', f.s.projectA.id);
    await pmA.next<ActivityUpdateEvent>('activity:update', (e) => e.running !== null);
    f.h.advance(60_000);
    await startTimer('workerA', f.s.projectB.id, 'Build');

    const onB = await pmB.next<ActivityUpdateEvent>('activity:update', (e) => e.running !== null);
    expect(onB.running?.project.id).toBe(f.s.projectB.id);
    await pmA.next<ActivityUpdateEvent>('activity:update', (e) => e.running === null);
    await admin.next<ActivityUpdateEvent>(
      'activity:update',
      (e) => e.running?.project.id === f.s.projectB.id,
    );
    // pmA never learns where workerA went.
    expect(
      pmA
        .all<ActivityUpdateEvent>('activity:update')
        .some((e) => e.running?.project.id === f.s.projectB.id),
    ).toBe(false);
  });

  it('sends a snapshot of running timers on connect, scoped like the updates', async () => {
    await insertEntry({
      userId: f.s.users.workerA.id,
      projectId: f.s.projectA.id,
      startedAt: '2026-10-31T11:00:00Z',
      endedAt: null,
      source: 'TIMER',
    });
    await insertEntry({
      userId: f.s.users.workerB.id,
      projectId: f.s.projectB.id,
      startedAt: '2026-10-31T11:30:00Z',
      endedAt: null,
      source: 'TIMER',
    });
    const names = async (who: 'pmA' | 'pmB' | 'admin') => {
      const client = await join(f, who);
      const snapshot = activitySnapshotEventSchema.parse(await client.next('activity:snapshot'));
      return snapshot.items.map((i) => i.user.name);
    };
    expect(await names('pmA')).toEqual(['Anahit Worker']);
    expect(await names('pmB')).toEqual(['Bob Worker']);
    expect(await names('admin')).toEqual(['Anahit Worker', 'Bob Worker']);
  });

  it('manual entries don’t produce activity updates', async () => {
    const pmA = await join(f, 'pmA');
    const tab = await join(f, 'workerA');
    await f.s
      .as('workerA')
      .post('/time-entries')
      .send({
        projectId: f.s.projectA.id,
        start: { date: '2026-10-30', time: '09:00' },
        end: { date: '2026-10-30', time: '10:00' },
      });
    await tab.next('entry:saved');
    await settle();
    expect(pmA.all('activity:update')).toEqual([]);
  });

  it('auto-stopped timers reach the worker’s tabs and the PM', async () => {
    await insertEntry({
      userId: f.s.users.workerA.id,
      projectId: f.s.projectA.id,
      startedAt: '2026-10-30T20:00:00Z',
      endedAt: null,
      source: 'TIMER',
    });
    const tab = await join(f, 'workerA');
    const pmA = await join(f, 'pmA');
    const jobs = createJobs({
      prisma: prisma(),
      logger: (await import('pino')).pino({ level: 'silent' }),
      clock: f.h.clock,
      events: f.h.events,
    });
    expect(await jobs.autoStop.run()).toBe(1);
    const event = await tab.next<EntrySavedEvent>('entry:saved', saved('auto_stopped'));
    expect(event.entry).toMatchObject({ source: 'AUTO_STOPPED', durationSeconds: 12 * 3600 });
    await pmA.next<ActivityUpdateEvent>('activity:update', (e) => e.running === null);
  });

  it('deactivating a worker with a running timer tells the PM they stopped', async () => {
    const pmA = await join(f, 'pmA');
    await startTimer('workerA', f.s.projectA.id);
    await pmA.next<ActivityUpdateEvent>('activity:update', (e) => e.running !== null);
    f.h.advance(60_000);
    await f.s.as('admin').post(`/users/${f.s.users.workerA.id}/deactivate`);
    await pmA.next<ActivityUpdateEvent>('activity:update', (e) => e.running === null);
  });
});

describe('room changes follow access changes', () => {
  it('a PM assigned to a project starts watching it (with a snapshot); removed, stops', async () => {
    await insertEntry({
      userId: f.s.users.workerA.id,
      projectId: f.s.projectA.id,
      startedAt: '2026-10-31T11:00:00Z',
      endedAt: null,
      source: 'TIMER',
    });
    const pmB = await join(f, 'pmB');
    await pmB.next('activity:snapshot');
    const add = await f.s
      .as('admin')
      .put(`/projects/${f.s.projectA.id}/members/${f.s.users.pmB.id}`)
      .send({ roleInProject: 'PM' });
    expect(add.status, JSON.stringify(add.body)).toBeLessThan(300);
    const snapshot = await pmB.next<{ items: { user: { name: string } }[] }>(
      'activity:snapshot',
      (e) => e.items.length > 0,
    );
    expect(snapshot.items.map((i) => i.user.name)).toEqual(['Anahit Worker']);
    expect(roomsOf(f, pmB)).toContain(`project:${f.s.projectA.id}`);

    await f.s.as('admin').delete(`/projects/${f.s.projectA.id}/members/${f.s.users.pmB.id}`);
    // A third snapshot (after connect and after being added), now without project A.
    const deadline = Date.now() + 3000;
    while (pmB.all('activity:snapshot').length < 3 && Date.now() < deadline) await settle(20);
    expect(pmB.all<{ items: unknown[] }>('activity:snapshot')[2]?.items).toEqual([]);
    expect(roomsOf(f, pmB)).not.toContain(`project:${f.s.projectA.id}`);

    f.h.advance(60_000);
    await f.s.as('workerA').post('/timer/stop');
    await settle();
    expect(
      pmB.all<ActivityUpdateEvent>('activity:update').filter(about(f.s.users.workerA.id)),
    ).toEqual([]);
  });

  it('a PM demoted to worker leaves all project rooms immediately', async () => {
    const pmA = await join(f, 'pmA');
    expect(roomsOf(f, pmA).some((r) => r.startsWith('project:'))).toBe(true);
    const res = await f.s
      .as('admin')
      .patch(`/users/${f.s.users.pmA.id}/role`)
      .send({ role: UserRole.WORKER });
    expect(res.status).toBe(200);
    const deadline = Date.now() + 3000;
    while (roomsOf(f, pmA).some((r) => r.startsWith('project:')) && Date.now() < deadline)
      await settle(20);
    expect(roomsOf(f, pmA).filter((r) => r.startsWith('project:') || r === 'admin')).toEqual([]);

    await startTimer('workerA', f.s.projectA.id);
    await settle();
    expect(pmA.all('activity:update')).toEqual([]);
  });
});
