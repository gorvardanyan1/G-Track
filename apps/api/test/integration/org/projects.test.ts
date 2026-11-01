import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { clientResponseSchema, projectResponseSchema } from '@tempo/shared';
import { z } from 'zod';
import { createHarness, errorCode, prisma, resetDatabase, type Harness } from '../auth/harness.ts';
import { createScenario, type Scenario } from './scenario.ts';

let h: Harness;
let s: Scenario;
const projectList = z.array(projectResponseSchema);

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  s = await createScenario(h);
});
afterAll(async () => {
  await prisma().$disconnect();
});

const names = (body: unknown) => projectList.parse(body).map((p) => p.name);

describe('project visibility', () => {
  it('Super Admin sees every project', async () => {
    expect(names((await s.as('admin').get('/projects')).body)).toEqual(['Project A', 'Project B']);
    expect(names((await s.as('admin').get('/projects?includeArchived=true')).body)).toEqual([
      'Old Project',
      'Project A',
      'Project B',
    ]);
  });

  it('a PM sees only projects they manage', async () => {
    expect(names((await s.as('pmA').get('/projects')).body)).toEqual(['Project A']);
    expect(names((await s.as('pmB').get('/projects?includeArchived=true')).body)).toEqual([
      'Project B',
    ]);
  });

  it('a worker sees only assigned projects; an unassigned worker sees none', async () => {
    expect(names((await s.as('workerA').get('/projects?includeArchived=true')).body)).toEqual([
      'Old Project',
      'Project A',
    ]);
    expect(names((await s.as('outsider').get('/projects')).body)).toEqual([]);
  });

  it('workers do not see the budget; managers do', async () => {
    const worker = projectResponseSchema.parse(
      (await s.as('workerA').get(`/projects/${s.projectA.id}`)).body,
    );
    expect(worker).toMatchObject({ access: 'member', client: { name: 'Northwind' } });
    expect(worker).not.toHaveProperty('budgetHours');

    const pm = projectResponseSchema.parse(
      (await s.as('pmA').get(`/projects/${s.projectA.id}`)).body,
    );
    expect(pm).toMatchObject({ access: 'manager', budgetHours: 100 });
  });

  it('removing a worker from a project hides it from them', async () => {
    await s.as('pmA').delete(`/projects/${s.projectA.id}/members/${s.users.workerA.id}`);
    expect((await s.as('workerA').get(`/projects/${s.projectA.id}`)).status).toBe(404);
  });
});

describe('creating and editing projects', () => {
  it('Super Admin creates a project and it is audited', async () => {
    const res = await s
      .as('admin')
      .post('/projects')
      .send({ clientId: s.client.id, name: 'New', color: '#123456', budgetHours: 40.5 });
    expect(res.status).toBe(201);
    expect(projectResponseSchema.parse(res.body)).toMatchObject({
      name: 'New',
      budgetHours: 40.5,
      isBillable: true,
      access: 'admin',
    });
    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'project.created' },
    });
    expect(audit.after).toMatchObject({ name: 'New', budgetHours: 40.5 });
  });

  it('validates input', async () => {
    expect(
      errorCode(await s.as('admin').post('/projects').send({ name: 'X', color: 'blue' })),
    ).toBe('VALIDATION_ERROR');
    expect(
      errorCode(
        await s
          .as('admin')
          .post('/projects')
          .send({ name: 'X', color: '#000000', budgetHours: 1.234 }),
      ),
    ).toBe('VALIDATION_ERROR');
    expect(
      errorCode(await s.as('admin').post('/projects').send({ name: '', color: '#000000' })),
    ).toBe('VALIDATION_ERROR');
    const archivedClient = await prisma().client.create({
      data: { name: 'Gone', archivedAt: new Date() },
    });
    expect(
      (
        await s
          .as('admin')
          .post('/projects')
          .send({ clientId: archivedClient.id, name: 'X', color: '#000000' })
      ).status,
    ).toBe(400);
  });

  it('rejects duplicate names within a client', async () => {
    const res = await s
      .as('admin')
      .post('/projects')
      .send({ clientId: s.client.id, name: 'Project A', color: '#000000' });
    expect(res.status).toBe(409);
  });

  it('a PM can change the budget and the change is audited with before/after', async () => {
    const res = await s.as('pmA').patch(`/projects/${s.projectA.id}`).send({ budgetHours: 120 });
    expect(projectResponseSchema.parse(res.body).budgetHours).toBe(120);
    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'project.updated' },
    });
    expect(audit).toMatchObject({
      actorId: s.users.pmA.id,
      before: { budgetHours: 100 },
      after: { budgetHours: 120 },
    });
  });

  it('archived projects are read-only until unarchived', async () => {
    expect(
      (await s.as('pmA').patch(`/projects/${s.archived.id}`).send({ budgetHours: 5 })).status,
    ).toBe(409);
    expect(
      (await s.as('pmA').post(`/projects/${s.archived.id}/tasks`).send({ name: 'X' })).status,
    ).toBe(409);
    await s.as('admin').post(`/projects/${s.archived.id}/unarchive`);
    expect(
      (await s.as('pmA').patch(`/projects/${s.archived.id}`).send({ budgetHours: 5 })).status,
    ).toBe(200);
    expect(await prisma().auditLog.count({ where: { action: 'project.unarchived' } })).toBe(1);
  });
});

describe('clients', () => {
  it('Super Admin creates, renames, archives and unarchives clients (all audited)', async () => {
    const created = clientResponseSchema.parse(
      (await s.as('admin').post('/clients').send({ name: 'Acme' })).body,
    );
    await s.as('admin').patch(`/clients/${created.id}`).send({ name: 'Acme Corp' });
    await s.as('admin').post(`/clients/${created.id}/archive`);
    expect((await s.as('admin').get('/clients')).body).not.toContainEqual(
      expect.objectContaining({ id: created.id }),
    );
    expect((await s.as('admin').get('/clients?includeArchived=true')).body).toContainEqual(
      expect.objectContaining({ name: 'Acme Corp' }),
    );
    await s.as('admin').post(`/clients/${created.id}/unarchive`);

    const actions = (
      await prisma().auditLog.findMany({
        where: { targetId: created.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      })
    ).map((a) => a.action);
    expect(actions).toEqual([
      'client.created',
      'client.updated',
      'client.archived',
      'client.unarchived',
    ]);
  });

  it('rejects duplicate client names', async () => {
    expect((await s.as('admin').post('/clients').send({ name: 'Northwind' })).status).toBe(409);
  });
});
