import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { UserRole } from '@tempo/shared';
import { cookieHeader, login, prisma } from '../auth/harness.ts';
import { connect, connectError, settle } from './client.ts';
import {
  join,
  roomsOf,
  sessionIdOf,
  setRole,
  setUp,
  tearDown,
  type RealtimeFixture,
} from './fixture.ts';

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

describe('connecting', () => {
  it('requires a valid, unexpired access token of a live session', async () => {
    const { url } = f.server;
    expect(await connectError(url)).toBe('UNAUTHORIZED');
    expect(await connectError(url, 'not-a-jwt')).toBe('UNAUTHORIZED');

    const token = f.s.token('workerA');
    f.h.advance(15 * 60_000);
    expect(await connectError(url, token)).toBe('UNAUTHORIZED');

    await prisma().refreshToken.updateMany({
      where: { userId: f.s.users.workerB.id },
      data: { revokedAt: f.h.now() },
    });
    expect(await connectError(url, f.s.token('workerB'))).toBe('UNAUTHORIZED');

    await prisma().user.update({ where: { id: f.s.users.pmA.id }, data: { isActive: false } });
    expect(await connectError(url, f.s.token('pmA'))).toBe('UNAUTHORIZED');
  });

  it('refuses a Super Admin without 2FA', async () => {
    await prisma().user.update({
      where: { id: f.s.users.admin.id },
      data: { totpEnabledAt: null },
    });
    expect(await connectError(f.server.url, f.s.token('admin'))).toBe('TWO_FACTOR_REQUIRED');
  });

  it('refuses origins outside the allowlist, and no origin at all', async () => {
    const token = f.s.token('workerA');
    expect(await connectError(f.server.url, token, 'https://evil.test')).not.toBe('connected');
    expect(await connectError(f.server.url, token, '')).not.toBe('connected');
    expect(await connectError(f.server.url, token)).toBe('connected');
  });

  it('limits connections per user', async () => {
    for (let i = 0; i < 20; i++) await join(f, 'workerA');
    expect(await connectError(f.server.url, f.s.token('workerA'))).toBe('TOO_MANY_CONNECTIONS');
    expect(await connectError(f.server.url, f.s.token('workerB'))).toBe('connected');
  });
});

describe('room authorization', () => {
  it('a worker is only in their own user and session rooms', async () => {
    const token = f.s.token('workerA');
    const client = await join(f, 'workerA', token);
    expect(roomsOf(f, client)).toEqual(
      [`session:${sessionIdOf(token)}`, `user:${f.s.users.workerA.id}`].sort(),
    );
  });

  it('a PM is also in the rooms of exactly the projects they manage', async () => {
    const a = await join(f, 'pmA');
    expect(roomsOf(f, a).filter((r) => r.startsWith('project:'))).toEqual(
      [`project:${f.s.projectA.id}`, `project:${f.s.archived.id}`].sort(),
    );
    const b = await join(f, 'pmB');
    expect(roomsOf(f, b).filter((r) => r.startsWith('project:'))).toEqual([
      `project:${f.s.projectB.id}`,
    ]);
    expect(roomsOf(f, a)).not.toContain('admin');
  });

  it('a Super Admin is in the admin room and no project rooms', async () => {
    const client = await join(f, 'admin');
    const rooms = roomsOf(f, client);
    expect(rooms).toContain('admin');
    expect(rooms.some((r) => r.startsWith('project:'))).toBe(false);
  });

  it('PM membership alone is not enough: a demoted PM watches nothing', async () => {
    await setRole(f.s.users.pmA.id, UserRole.WORKER);
    const client = await join(f, 'pmA');
    expect(roomsOf(f, client).filter((r) => r.startsWith('project:') || r === 'admin')).toEqual([]);
  });

  it('clients cannot join rooms themselves', async () => {
    const client = await join(f, 'workerA');
    const before = roomsOf(f, client);
    for (const name of ['join', 'subscribe', 'joinRoom']) {
      client.socket.emit(name, 'admin');
      client.socket.emit(name, { room: `project:${f.s.projectA.id}` });
    }
    await settle();
    expect(roomsOf(f, client)).toEqual(before);
    expect(client.socket.connected).toBe(true);
  });

  it('a worker never receives the activity snapshot; PMs get theirs on connect', async () => {
    const worker = await join(f, 'workerA');
    const pm = await join(f, 'pmA');
    await pm.next('activity:snapshot');
    await settle();
    expect(worker.all('activity:snapshot')).toEqual([]);
  });
});

describe('session lifecycle', () => {
  it('closes the connection when its token expires, after telling the client', async () => {
    const signer = await f.h.session(f.s.users.workerA.id);
    const client = await connect(f.server.url, signer(1));
    f.clients.push(client);
    await client.next('auth:expired');
    expect(await client.disconnected()).toBe('io server disconnect');
  });

  it('logging out closes only that session’s connections', async () => {
    const keep = await join(f, 'workerA');
    const session = await login(f.h, 'worker.a@tempo.test');
    const drop = await join(f, 'workerA', session.accessToken);
    const res = await f.h.post('/logout').set('Cookie', cookieHeader(session.refreshToken));
    expect(res.status).toBe(204);
    expect(await drop.disconnected()).toBe('io server disconnect');
    await settle();
    expect(keep.socket.connected).toBe(true);
  });

  it('“log out everywhere” closes every connection of the user', async () => {
    const tabs = [await join(f, 'workerA'), await join(f, 'workerA')];
    const other = await join(f, 'workerB');
    const res = await f.s.as('workerA').post('/auth/logout-all');
    expect(res.status).toBe(204);
    for (const tab of tabs) expect(await tab.disconnected()).toBe('io server disconnect');
    await settle();
    expect(other.socket.connected).toBe(true);
  });

  it('deactivating a user closes their connections', async () => {
    const tab = await join(f, 'workerA');
    expect((await f.s.as('admin').post(`/users/${f.s.users.workerA.id}/deactivate`)).status).toBe(
      200,
    );
    expect(await tab.disconnected()).toBe('io server disconnect');
  });
});
