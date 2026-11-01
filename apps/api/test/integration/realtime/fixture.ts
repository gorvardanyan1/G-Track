import type { UserRole } from '@tempo/shared';
import { createHarness, prisma, resetDatabase, type Harness } from '../auth/harness.ts';
import { createScenario, type Scenario } from '../org/scenario.ts';
import { connect, type TestClient } from './client.ts';

export interface RealtimeFixture {
  h: Harness;
  s: Scenario;
  server: Awaited<ReturnType<Harness['listen']>>;
  clients: TestClient[];
}

export async function setUp(): Promise<RealtimeFixture> {
  await resetDatabase();
  const h = createHarness();
  h.setNow('2026-10-31T12:00:00Z');
  const s = await createScenario(h);
  return { h, s, server: await h.listen(), clients: [] };
}

export async function tearDown(f: RealtimeFixture | undefined): Promise<void> {
  if (!f) return;
  for (const client of f.clients) client.socket.close();
  await f.server.close();
}

/** Server-side rooms of a client's connection (excluding its own id room). */
export function roomsOf(f: RealtimeFixture, client: TestClient): string[] {
  const socket = f.server.realtime.io.sockets.sockets.get(client.socket.id ?? '');
  return [...(socket?.rooms ?? [])].filter((room) => room !== client.socket.id).sort();
}

/** Connects as a scenario user and waits until the server has put the socket in its rooms. */
export async function join(
  f: RealtimeFixture,
  who: Parameters<Scenario['token']>[0],
  token = f.s.token(who),
): Promise<TestClient> {
  const client = await connect(f.server.url, token);
  f.clients.push(client);
  const deadline = Date.now() + 3000;
  while (!roomsOf(f, client).some((room) => room.startsWith('user:'))) {
    if (Date.now() > deadline) throw new Error('socket never joined its rooms');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return client;
}

/** The session family id inside an access token. */
export function sessionIdOf(token: string): string {
  const payload = token.split('.')[1] ?? '';
  return (JSON.parse(Buffer.from(payload, 'base64url').toString()) as { sid: string }).sid;
}

export async function setRole(userId: string, role: UserRole): Promise<void> {
  await prisma().user.update({ where: { id: userId }, data: { role } });
}
