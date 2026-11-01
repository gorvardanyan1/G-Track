import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { memberResponseSchema, taskResponseSchema } from '@tempo/shared';
import { z } from 'zod';
import { createHarness, prisma, resetDatabase, type Harness } from '../auth/harness.ts';
import { createScenario, type Scenario } from './scenario.ts';

let h: Harness;
let s: Scenario;

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  s = await createScenario(h);
});
afterAll(async () => {
  await prisma().$disconnect();
});

const pA = () => `/projects/${s.projectA.id}`;

describe('members', () => {
  it('lists members with rates for managers', async () => {
    const members = z
      .array(memberResponseSchema)
      .parse((await s.as('pmA').get(`${pA()}/members`)).body);
    expect(members.map((m) => [m.email, m.roleInProject, m.hourlyRate])).toEqual([
      ['pm.a@tempo.test', 'PM', null],
      ['worker.a@tempo.test', 'WORKER', 80],
    ]);
  });

  it('a PM adds a worker, sets a rate, and it is audited', async () => {
    const added = await s
      .as('pmA')
      .put(`${pA()}/members/${s.users.outsider.id}`)
      .send({ roleInProject: 'WORKER', hourlyRate: 72.5 });
    expect(memberResponseSchema.parse(added.body)).toMatchObject({
      roleInProject: 'WORKER',
      hourlyRate: 72.5,
    });
    await s
      .as('pmA')
      .put(`${pA()}/members/${s.users.outsider.id}`)
      .send({ roleInProject: 'WORKER', hourlyRate: 75 });

    const audits = await prisma().auditLog.findMany({
      where: { action: { startsWith: 'project.member' } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(audits.map((a) => a.action)).toEqual(['project.member_added', 'project.member_updated']);
    expect(audits[1]).toMatchObject({ before: { hourlyRate: 72.5 }, after: { hourlyRate: 75 } });
    expect((await s.as('outsider').get(pA())).status).toBe(200);
  });

  it('only users with the matching global role can be assigned', async () => {
    expect(
      (await s.as('pmA').put(`${pA()}/members/${s.users.pmB.id}`).send({ roleInProject: 'WORKER' }))
        .status,
    ).toBe(400);
    expect(
      (
        await s
          .as('admin')
          .put(`${pA()}/members/${s.users.outsider.id}`)
          .send({ roleInProject: 'PM' })
      ).status,
    ).toBe(400);
    expect(
      (
        await s
          .as('admin')
          .put(`${pA()}/members/${s.users.admin.id}`)
          .send({ roleInProject: 'WORKER' })
      ).status,
    ).toBe(400);
  });

  it('a PM cannot change or remove a PM membership', async () => {
    await s.as('admin').put(`${pA()}/members/${s.users.pmB.id}`).send({ roleInProject: 'PM' });
    expect(
      (
        await s
          .as('pmA')
          .put(`${pA()}/members/${s.users.pmB.id}`)
          .send({ roleInProject: 'PM', hourlyRate: 1 })
      ).status,
    ).toBe(403);
    expect((await s.as('pmA').delete(`${pA()}/members/${s.users.pmB.id}`)).status).toBe(403);
  });

  it('a PM cannot promote a worker to PM', async () => {
    expect(
      (await s.as('pmA').put(`${pA()}/members/${s.users.workerA.id}`).send({ roleInProject: 'PM' }))
        .status,
    ).toBe(403);
  });

  it('candidates: PMs get workers only, admins get workers and PMs, never existing members', async () => {
    const forPm = (await s.as('pmA').get(`${pA()}/member-candidates`)).body as { email: string }[];
    expect(forPm.map((u) => u.email).sort()).toEqual([
      'outsider@tempo.test',
      'worker.b@tempo.test',
    ]);
    const forAdmin = (await s.as('admin').get(`${pA()}/member-candidates`)).body as {
      email: string;
    }[];
    expect(forAdmin.map((u) => u.email).sort()).toEqual([
      'outsider@tempo.test',
      'pm.b@tempo.test',
      'worker.b@tempo.test',
    ]);
  });

  it('removing an unknown member is a 404 and removal is audited', async () => {
    expect((await s.as('pmA').delete(`${pA()}/members/${s.users.outsider.id}`)).status).toBe(404);
    await s.as('pmA').delete(`${pA()}/members/${s.users.workerA.id}`);
    expect(
      await prisma().auditLog.findFirstOrThrow({ where: { action: 'project.member_removed' } }),
    ).toMatchObject({
      before: { userId: s.users.workerA.id, roleInProject: 'WORKER', hourlyRate: 80 },
    });
  });
});

describe('tasks', () => {
  it('a PM creates, renames, completes and deletes tasks (audited)', async () => {
    const created = taskResponseSchema.parse(
      (await s.as('pmA').post(`${pA()}/tasks`).send({ name: 'Review' })).body,
    );
    await s
      .as('pmA')
      .patch(`${pA()}/tasks/${created.id}`)
      .send({ name: 'Code review', isDone: true });
    const tasks = z
      .array(taskResponseSchema)
      .parse((await s.as('workerA').get(`${pA()}/tasks`)).body);
    expect(tasks.map((t) => [t.name, t.isDone])).toEqual([
      ['Design', false],
      ['Code review', true],
    ]);
    await s.as('pmA').delete(`${pA()}/tasks/${created.id}`);
    const actions = (
      await prisma().auditLog.findMany({
        where: { targetId: created.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    ).map((a) => a.action);
    expect(actions).toEqual(['task.created', 'task.updated', 'task.deleted']);
  });

  it('rejects duplicate task names', async () => {
    expect((await s.as('pmA').post(`${pA()}/tasks`).send({ name: 'Design' })).status).toBe(409);
  });

  it('refuses to delete a task that has time entries', async () => {
    await prisma().timeEntry.create({
      data: {
        userId: s.users.workerA.id,
        projectId: s.projectA.id,
        taskId: s.taskA.id,
        startedAt: new Date('2026-10-01T09:00:00Z'),
        endedAt: new Date('2026-10-01T10:00:00Z'),
        source: 'MANUAL',
      },
    });
    const res = await s.as('pmA').delete(`${pA()}/tasks/${s.taskA.id}`);
    expect(res.status).toBe(409);
    expect(await prisma().task.count({ where: { id: s.taskA.id } })).toBe(1);
  });
});
