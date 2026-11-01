import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pageSchema, userResponseSchema, UserRole } from '@tempo/shared';
import {
  createHarness,
  createUser,
  errorCode,
  PASSWORD,
  prisma,
  resetDatabase,
  type Harness,
} from '../auth/harness.ts';
import { createScenario, type Scenario } from './scenario.ts';

let h: Harness;
let s: Scenario;
const usersPage = pageSchema(userResponseSchema);

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  s = await createScenario(h);
});
afterAll(async () => {
  await prisma().$disconnect();
});

async function lastAudit(action: string) {
  return prisma().auditLog.findFirstOrThrow({
    where: { action },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
  });
}

describe('GET /users', () => {
  it('lists, filters, searches and paginates', async () => {
    const all = usersPage.parse((await s.as('admin').get('/users')).body);
    expect(all.total).toBe(6);
    expect(all.items.map((u) => u.name)).toEqual([...all.items.map((u) => u.name)].sort());
    expect(JSON.stringify(all)).not.toMatch(/passwordHash|totpSecret|argon2/);

    const pms = usersPage.parse((await s.as('admin').get('/users?role=PROJECT_MANAGER')).body);
    expect(pms.items.map((u) => u.email).sort()).toEqual(['pm.a@tempo.test', 'pm.b@tempo.test']);

    const search = usersPage.parse((await s.as('admin').get('/users?search=OUTSIDER')).body);
    expect(search.items.map((u) => u.email)).toEqual(['outsider@tempo.test']);

    const page2 = usersPage.parse((await s.as('admin').get('/users?page=2&pageSize=4')).body);
    expect(page2).toMatchObject({ total: 6, page: 2, pageSize: 4 });
    expect(page2.items).toHaveLength(2);
  });

  it('validates query parameters', async () => {
    expect(errorCode(await s.as('admin').get('/users?pageSize=500'))).toBe('VALIDATION_ERROR');
    expect(errorCode(await s.as('admin').get('/users?role=OWNER'))).toBe('VALIDATION_ERROR');
  });
});

describe('changing roles', () => {
  it('changes the role, audits before/after, and takes effect immediately', async () => {
    const res = await s
      .as('admin')
      .patch(`/users/${s.users.workerA.id}/role`)
      .send({ role: 'PROJECT_MANAGER' });
    expect(res.status).toBe(200);
    expect(userResponseSchema.parse(res.body).role).toBe('PROJECT_MANAGER');

    const audit = await lastAudit('user.role_changed');
    expect(audit).toMatchObject({
      actorId: s.users.admin.id,
      targetId: s.users.workerA.id,
      before: { role: 'WORKER' },
      after: { role: 'PROJECT_MANAGER' },
    });
    const me = await s.as('workerA').get('/auth/me');
    expect((me.body as { role: string }).role).toBe('PROJECT_MANAGER');
  });

  it('a demoted PM keeps the project but loses management rights', async () => {
    await s.as('admin').patch(`/users/${s.users.pmA.id}/role`).send({ role: 'WORKER' });
    const project = await s.as('pmA').get(`/projects/${s.projectA.id}`);
    expect((project.body as { access: string }).access).toBe('member');
    expect(
      (await s.as('pmA').post(`/projects/${s.projectA.id}/tasks`).send({ name: 'X' })).status,
    ).toBe(403);
  });

  it('refuses to change your own role', async () => {
    const res = await s
      .as('admin')
      .patch(`/users/${s.users.admin.id}/role`)
      .send({ role: 'WORKER' });
    expect(res.status).toBe(409);
  });

  it('admins can demote other admins, but nobody demotes themselves, so one admin always remains', async () => {
    const second = await createUser({ email: 'admin2@tempo.test', role: UserRole.SUPER_ADMIN });
    const token = await h.sessionToken(second.id);
    // Second admin has no 2FA, so make it usable first.
    await prisma().user.update({ where: { id: second.id }, data: { totpEnabledAt: new Date() } });
    expect(
      (await h.api(token).patch(`/users/${s.users.admin.id}/role`).send({ role: 'WORKER' })).status,
    ).toBe(200);
    // admin2 is now the only Super Admin, and can't demote themselves.
    expect(
      (await h.api(token).patch(`/users/${second.id}/role`).send({ role: 'WORKER' })).status,
    ).toBe(409);
  });

  it('two admins demoting each other at the same moment leave one admin, not none', async () => {
    const second = await createUser({ email: 'admin2@tempo.test', role: UserRole.SUPER_ADMIN });
    await prisma().user.update({ where: { id: second.id }, data: { totpEnabledAt: new Date() } });
    const secondToken = await h.sessionToken(second.id);
    const [a, b] = await Promise.all([
      s.as('admin').patch(`/users/${second.id}/role`).send({ role: 'WORKER' }),
      h.api(secondToken).patch(`/users/${s.users.admin.id}/role`).send({ role: 'WORKER' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma().user.count({ where: { role: 'SUPER_ADMIN', isActive: true } })).toBe(1);
  });

  it('two admins deactivating each other at the same moment leave one admin', async () => {
    const second = await createUser({ email: 'admin2@tempo.test', role: UserRole.SUPER_ADMIN });
    await prisma().user.update({ where: { id: second.id }, data: { totpEnabledAt: new Date() } });
    const secondToken = await h.sessionToken(second.id);
    const [a, b] = await Promise.all([
      s.as('admin').post(`/users/${second.id}/deactivate`),
      h.api(secondToken).post(`/users/${s.users.admin.id}/deactivate`),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(await prisma().user.count({ where: { role: 'SUPER_ADMIN', isActive: true } })).toBe(1);
  });

  it('404s for unknown users', async () => {
    const res = await s
      .as('admin')
      .patch('/users/00000000-0000-4000-8000-000000000000/role')
      .send({ role: 'WORKER' });
    expect(res.status).toBe(404);
  });
});

describe('deactivation', () => {
  it('ends sessions immediately and blocks login; reactivation restores access', async () => {
    const res = await s.as('admin').post(`/users/${s.users.workerA.id}/deactivate`);
    expect(userResponseSchema.parse(res.body).isActive).toBe(false);
    expect((await s.as('workerA').get('/auth/me')).status).toBe(401);
    expect(
      await prisma().refreshToken.count({ where: { userId: s.users.workerA.id, revokedAt: null } }),
    ).toBe(0);
    const login = await h.post('/login').send({ email: 'worker.a@tempo.test', password: PASSWORD });
    expect(errorCode(login)).toBe('ACCOUNT_DISABLED');
    expect(await lastAudit('user.deactivated')).toMatchObject({
      before: { isActive: true },
      after: { isActive: false },
    });

    await s.as('admin').post(`/users/${s.users.workerA.id}/activate`);
    expect(
      (await h.post('/login').send({ email: 'worker.a@tempo.test', password: PASSWORD })).status,
    ).toBe(200);
    expect(await lastAudit('user.activated')).toBeTruthy();
  });

  it('refuses to deactivate yourself', async () => {
    expect((await s.as('admin').post(`/users/${s.users.admin.id}/deactivate`)).status).toBe(409);
  });

  it('inactive users disappear from member candidates', async () => {
    await s.as('admin').post(`/users/${s.users.outsider.id}/deactivate`);
    const res = await s.as('pmA').get(`/projects/${s.projectA.id}/member-candidates`);
    expect((res.body as { id: string }[]).map((u) => u.id)).not.toContain(s.users.outsider.id);
  });
});

describe('revoking sessions', () => {
  it('logs the user out everywhere without deactivating them', async () => {
    const res = await s.as('admin').post(`/users/${s.users.pmA.id}/revoke-sessions`);
    expect(res.status).toBe(204);
    expect((await s.as('pmA').get('/auth/me')).status).toBe(401);
    expect(
      (await prisma().user.findUniqueOrThrow({ where: { id: s.users.pmA.id } })).isActive,
    ).toBe(true);
    expect(await lastAudit('user.sessions_revoked')).toMatchObject({
      targetId: s.users.pmA.id,
      after: { sessionsRevoked: 1 },
    });
  });
});

describe('invites', () => {
  it('creates, lists and revokes pending invites', async () => {
    const created = await s
      .as('admin')
      .post('/users/invites')
      .send({ email: 'new@tempo.test', role: 'WORKER' });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;

    const pending = await s.as('admin').get('/users/invites');
    expect((pending.body as { email: string }[]).map((i) => i.email)).toEqual(['new@tempo.test']);

    expect((await s.as('admin').delete(`/users/invites/${id}`)).status).toBe(204);
    expect((await s.as('admin').get('/users/invites')).body).toEqual([]);
    expect((await s.as('admin').delete(`/users/invites/${id}`)).status).toBe(404);
    expect(await lastAudit('user.invite.revoked')).toMatchObject({
      before: { email: 'new@tempo.test' },
    });

    const token = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.messages.at(-1)?.text ?? '')?.[1] ?? '';
    const accept = await h
      .post('/invites/accept')
      .send({ token, name: 'New', password: 'a long enough passphrase', timezone: 'UTC' });
    expect(errorCode(accept)).toBe('INVALID_TOKEN');
  });
});
