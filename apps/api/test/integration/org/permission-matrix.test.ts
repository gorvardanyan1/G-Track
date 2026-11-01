import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, prisma, resetDatabase, type Harness } from '../auth/harness.ts';
import { createScenario, type Role, type Scenario } from './scenario.ts';

// Every row: who calls what, and the status the permission rules demand.
// 404 = not visible (or admin-only route); 403 = visible but not allowed.
type Row = [
  role: Role,
  method: 'get' | 'post' | 'put' | 'patch' | 'delete',
  path: (s: Scenario) => string,
  body: unknown,
  status: number,
];

const users = '/users';
const user = (s: Scenario) => `/users/${s.users.workerB.id}`;
const pA = (s: Scenario) => `/projects/${s.projectA.id}`;
const pB = (s: Scenario) => `/projects/${s.projectB.id}`;

const rows: Row[] = [
  // ── users: Super Admin only ───────────────────────────────────────────────
  ['admin', 'get', () => users, undefined, 200],
  ['pmA', 'get', () => users, undefined, 404],
  ['workerA', 'get', () => users, undefined, 404],
  ['pmA', 'get', user, undefined, 404],
  ['workerA', 'get', user, undefined, 404],
  ['pmA', 'patch', (s) => `${user(s)}/role`, { role: 'SUPER_ADMIN' }, 404],
  ['workerA', 'patch', (s) => `/users/${s.users.workerA.id}/role`, { role: 'SUPER_ADMIN' }, 404],
  ['pmA', 'post', (s) => `${user(s)}/deactivate`, undefined, 404],
  ['workerA', 'post', (s) => `${user(s)}/revoke-sessions`, undefined, 404],
  ['pmA', 'post', () => '/users/invites', { email: 'new@tempo.test', role: 'WORKER' }, 404],
  ['workerA', 'get', () => '/users/invites', undefined, 404],

  // ── clients: Super Admin only ─────────────────────────────────────────────
  ['admin', 'get', () => '/clients', undefined, 200],
  ['pmA', 'get', () => '/clients', undefined, 404],
  ['workerA', 'get', () => '/clients', undefined, 404],
  ['pmA', 'post', () => '/clients', { name: 'Acme' }, 404],
  ['pmA', 'patch', (s) => `/clients/${s.client.id}`, { name: 'Renamed' }, 404],
  ['workerA', 'post', (s) => `/clients/${s.client.id}/archive`, undefined, 404],

  // ── project visibility ────────────────────────────────────────────────────
  ['admin', 'get', pB, undefined, 200],
  ['pmA', 'get', pA, undefined, 200],
  ['pmA', 'get', pB, undefined, 404],
  ['workerA', 'get', pA, undefined, 200],
  ['workerA', 'get', pB, undefined, 404],
  ['outsider', 'get', pA, undefined, 404],
  ['pmA', 'get', () => '/projects/not-a-uuid', undefined, 404],
  ['pmA', 'get', () => '/projects/00000000-0000-4000-8000-000000000000', undefined, 404],

  // ── budget usage: managers only ───────────────────────────────────────────
  ['admin', 'get', () => '/projects/usage', undefined, 200],
  ['pmA', 'get', () => '/projects/usage', undefined, 200],
  ['workerA', 'get', () => '/projects/usage', undefined, 404],
  ['pmA', 'get', (s) => `${pA(s)}/usage`, undefined, 200],
  ['pmA', 'get', (s) => `${pB(s)}/usage`, undefined, 404],
  ['workerA', 'get', (s) => `${pA(s)}/usage`, undefined, 403],

  // ── project changes ───────────────────────────────────────────────────────
  ['pmA', 'post', () => '/projects', { name: 'Mine', color: '#000000' }, 404],
  ['workerA', 'post', () => '/projects', { name: 'Mine', color: '#000000' }, 404],
  ['admin', 'post', () => '/projects', { name: 'New', color: '#000000' }, 201],
  ['pmA', 'patch', pA, { budgetHours: 150 }, 200],
  ['pmA', 'patch', pA, { name: 'Renamed' }, 403],
  ['pmA', 'patch', pA, { isBillable: false }, 403],
  ['pmA', 'patch', pB, { budgetHours: 150 }, 404],
  ['workerA', 'patch', pA, { budgetHours: 150 }, 403],
  ['outsider', 'patch', pA, { budgetHours: 150 }, 404],
  ['admin', 'patch', pB, { name: 'Renamed B' }, 200],
  ['pmA', 'post', (s) => `${pA(s)}/archive`, undefined, 404],
  ['workerA', 'post', (s) => `${pA(s)}/archive`, undefined, 404],
  ['admin', 'post', (s) => `${pA(s)}/archive`, undefined, 200],

  // ── members ───────────────────────────────────────────────────────────────
  ['admin', 'get', (s) => `${pA(s)}/members`, undefined, 200],
  ['pmA', 'get', (s) => `${pA(s)}/members`, undefined, 200],
  ['pmA', 'get', (s) => `${pB(s)}/members`, undefined, 404],
  ['workerA', 'get', (s) => `${pA(s)}/members`, undefined, 403],
  ['workerA', 'get', (s) => `${pB(s)}/members`, undefined, 404],
  ['pmA', 'get', (s) => `${pA(s)}/member-candidates`, undefined, 200],
  ['workerA', 'get', (s) => `${pA(s)}/member-candidates`, undefined, 403],
  [
    'pmA',
    'put',
    (s) => `${pA(s)}/members/${s.users.outsider.id}`,
    { roleInProject: 'WORKER', hourlyRate: 70 },
    200,
  ],
  ['pmA', 'put', (s) => `${pA(s)}/members/${s.users.pmB.id}`, { roleInProject: 'PM' }, 403],
  [
    'pmA',
    'put',
    (s) => `${pB(s)}/members/${s.users.outsider.id}`,
    { roleInProject: 'WORKER' },
    404,
  ],
  [
    'workerA',
    'put',
    (s) => `${pA(s)}/members/${s.users.outsider.id}`,
    { roleInProject: 'WORKER' },
    403,
  ],
  [
    'outsider',
    'put',
    (s) => `${pA(s)}/members/${s.users.outsider.id}`,
    { roleInProject: 'WORKER' },
    404,
  ],
  ['admin', 'put', (s) => `${pA(s)}/members/${s.users.pmB.id}`, { roleInProject: 'PM' }, 200],
  ['pmA', 'delete', (s) => `${pA(s)}/members/${s.users.workerA.id}`, undefined, 204],
  ['pmA', 'delete', (s) => `${pA(s)}/members/${s.users.pmA.id}`, undefined, 403],
  ['pmA', 'delete', (s) => `${pB(s)}/members/${s.users.workerB.id}`, undefined, 404],
  ['workerA', 'delete', (s) => `${pA(s)}/members/${s.users.workerA.id}`, undefined, 403],
  ['admin', 'delete', (s) => `${pA(s)}/members/${s.users.pmA.id}`, undefined, 204],

  // ── tasks ─────────────────────────────────────────────────────────────────
  ['workerA', 'get', (s) => `${pA(s)}/tasks`, undefined, 200],
  ['workerA', 'get', (s) => `${pB(s)}/tasks`, undefined, 404],
  ['outsider', 'get', (s) => `${pA(s)}/tasks`, undefined, 404],
  ['pmA', 'post', (s) => `${pA(s)}/tasks`, { name: 'Review' }, 201],
  ['pmA', 'post', (s) => `${pB(s)}/tasks`, { name: 'Review' }, 404],
  ['workerA', 'post', (s) => `${pA(s)}/tasks`, { name: 'Review' }, 403],
  ['admin', 'post', (s) => `${pB(s)}/tasks`, { name: 'Review' }, 201],
  ['pmA', 'patch', (s) => `${pA(s)}/tasks/${s.taskA.id}`, { isDone: true }, 200],
  ['workerA', 'patch', (s) => `${pA(s)}/tasks/${s.taskA.id}`, { isDone: true }, 403],
  ['pmA', 'patch', (s) => `${pB(s)}/tasks/${s.taskB.id}`, { isDone: true }, 404],
  // A task id from another project under a visible project's path is "not found".
  ['pmA', 'patch', (s) => `${pA(s)}/tasks/${s.taskB.id}`, { isDone: true }, 404],
  ['pmA', 'delete', (s) => `${pA(s)}/tasks/${s.taskA.id}`, undefined, 204],
  ['workerA', 'delete', (s) => `${pA(s)}/tasks/${s.taskA.id}`, undefined, 403],
  ['pmB', 'delete', (s) => `${pA(s)}/tasks/${s.taskA.id}`, undefined, 404],
];

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

describe('permission matrix', () => {
  it.each(rows.map((row, i) => [i + 1, ...row] as const))(
    '#%i %s %s',
    async (_n, role, method, path, payload, status) => {
      const req = s.as(role)[method](path(s));
      const res = payload === undefined ? await req : await req.send(payload as object);
      expect(res.status, JSON.stringify(res.body)).toBe(status);
    },
  );

  it.each(['/users', '/clients', '/projects', '/users/invites'])(
    '%s requires authentication',
    async (path) => {
      expect((await h.api().get(path)).status).toBe(401);
    },
  );

  it('404s for invisible projects look exactly like missing ones', async () => {
    const hidden = await s.as('workerA').get(pB(s));
    const missing = await s.as('workerA').get('/projects/00000000-0000-4000-8000-000000000000');
    expect(hidden.body).toEqual(missing.body);
  });
});
