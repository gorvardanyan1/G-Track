import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, createApiClient } from '../src/api/client.ts';

const schema = z.object({ value: z.number() });
const session = (token: string) => ({
  status: 'authenticated',
  accessToken: token,
  accessTokenExpiresAt: '2026-11-01T12:15:00.000Z',
  user: {
    id: '0190e5b2-0000-7000-8000-000000000001',
    email: 'lena@tempo.test',
    name: 'Lena',
    role: 'WORKER',
    timezone: 'Europe/Berlin',
    twoFactorEnabled: false,
  },
});
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
const err = (status: number, code: string, message = 'nope') =>
  json(status, { error: { code, message } });

/** A fake api: routes by path, records calls. */
function setup(routes: Record<string, (init: RequestInit, n: number) => Response>) {
  const calls: { path: string; auth: string | null }[] = [];
  const counts: Record<string, number> = {};
  const fetch = vi.fn((url: string, init: RequestInit = {}) => {
    const path = url.replace('/api/v1', '').split('?')[0] ?? '';
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ path, auth: headers['Authorization'] ?? null });
    counts[path] = (counts[path] ?? 0) + 1;
    const route = routes[path];
    return Promise.resolve(route ? route(init, counts[path] ?? 1) : json(404, undefined));
  });
  let t = 1000;
  const client = createApiClient({
    baseUrl: '/api/v1',
    fetch: fetch as unknown as typeof globalThis.fetch,
    now: () => (t += 10),
    lock: (_name, task) => task(),
    sleep: () => Promise.resolve(),
  });
  return { client, calls, fetch };
}

describe('api client', () => {
  it('validates the response and sends the in-memory token and credentials', async () => {
    const { client, calls, fetch } = setup({ '/thing': () => json(200, { value: 1, extra: 'x' }) });
    client.setAccessToken('t1');
    await expect(client.request('/thing', schema)).resolves.toEqual({ value: 1 });
    expect(calls[0]).toEqual({ path: '/thing', auth: 'Bearer t1' });
    expect(fetch.mock.calls[0]?.[1]).toMatchObject({ credentials: 'include' });
  });

  it('turns error bodies into ApiError, and rejects unexpected shapes', async () => {
    const { client } = setup({
      '/missing': () => err(404, 'NOT_FOUND', 'Project not found'),
      '/odd': () => json(200, { value: 'x' }),
      '/broken': () => json(502, undefined),
    });
    client.setAccessToken('t');
    await expect(client.request('/missing', schema)).rejects.toMatchObject({
      status: 404,
      code: 'NOT_FOUND',
      message: 'Project not found',
    });
    await expect(client.request('/odd', schema)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
    const broken: unknown = await client.request('/broken', schema).catch((e: unknown) => e);
    expect(broken).toBeInstanceOf(ApiError);
    expect((broken as ApiError).status).toBe(502);
  });

  it('refreshes a stale token once and retries the request', async () => {
    const { client, calls } = setup({
      '/thing': (init) =>
        (init.headers as Record<string, string>)['Authorization'] === 'Bearer fresh'
          ? json(200, { value: 2 })
          : err(401, 'INVALID_TOKEN'),
      '/auth/refresh': () => json(200, session('fresh')),
    });
    const sessions: string[] = [];
    client.onSession((s) => sessions.push(s.accessToken));
    client.setAccessToken('stale');
    await expect(client.request('/thing', schema)).resolves.toEqual({ value: 2 });
    expect(calls.map((c) => c.path)).toEqual(['/thing', '/auth/refresh', '/thing']);
    expect(client.getAccessToken()).toBe('fresh');
    expect(sessions).toEqual(['fresh']);
  });

  it('shares one refresh between concurrent requests', async () => {
    const { client, calls } = setup({
      '/a': (init) =>
        (init.headers as Record<string, string>)['Authorization'] === 'Bearer fresh'
          ? json(200, { value: 1 })
          : err(401, 'INVALID_TOKEN'),
      '/auth/refresh': () => json(200, session('fresh')),
    });
    client.setAccessToken('stale');
    await Promise.all([
      client.request('/a', schema),
      client.request('/a', schema),
      client.request('/a', schema),
    ]);
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(1);
  });

  it('does not refresh for a wrong password (401 INVALID_CREDENTIALS)', async () => {
    const { client, calls } = setup({ '/auth/password': () => err(401, 'INVALID_CREDENTIALS') });
    client.setAccessToken('t');
    await expect(client.send('/auth/password', { method: 'POST', body: {} })).rejects.toMatchObject(
      { code: 'INVALID_CREDENTIALS' },
    );
    expect(calls.map((c) => c.path)).toEqual(['/auth/password']);
  });

  it('reports an expired session when the refresh fails', async () => {
    const { client } = setup({
      '/thing': () => err(401, 'INVALID_TOKEN'),
      '/auth/refresh': () => err(401, 'INVALID_TOKEN'),
    });
    const expired = vi.fn();
    client.onSessionExpired(expired);
    client.setAccessToken('stale');
    await expect(client.request('/thing', schema)).rejects.toMatchObject({ status: 401 });
    expect(expired).toHaveBeenCalledOnce();
    expect(client.getAccessToken()).toBeNull();
  });

  it('retries a refresh another tab is doing (409) and gets the session', async () => {
    const { client, calls } = setup({
      '/auth/refresh': (_init, n) => (n < 3 ? err(409, 'CONFLICT') : json(200, session('fresh'))),
    });
    await expect(client.refresh()).resolves.toMatchObject({ accessToken: 'fresh' });
    expect(calls.filter((c) => c.path === '/auth/refresh')).toHaveLength(3);
  });

  it('starts with a refresh when there is no token yet; public calls send none', async () => {
    const { client, calls } = setup({
      '/auth/refresh': () => json(200, session('boot')),
      '/thing': () => json(200, { value: 1 }),
      '/auth/login': () => json(200, { value: 1 }),
    });
    await client.request('/auth/login', schema, { auth: false, method: 'POST', body: {} });
    await client.request('/thing', schema);
    expect(calls).toEqual([
      { path: '/auth/login', auth: null },
      { path: '/auth/refresh', auth: null },
      { path: '/thing', auth: 'Bearer boot' },
    ]);
  });

  it('feeds X-Server-Time samples to listeners', async () => {
    const { client } = setup({
      '/thing': () => json(200, { value: 1 }, { 'X-Server-Time': '1730000000000' }),
    });
    const samples: unknown[] = [];
    client.onServerTime((s) => samples.push(s));
    client.setAccessToken('t');
    await client.request('/thing', schema);
    expect(samples).toEqual([{ requestStart: 1010, responseEnd: 1020, serverTime: 1730000000000 }]);
  });

  it('encodes query parameters, repeating arrays', async () => {
    const { client, fetch } = setup({ '/reports': () => json(200, { value: 1 }) });
    client.setAccessToken('t');
    await client.request('/reports', schema, {
      query: { from: '2026-10-01', projectId: ['a', 'b'], round: undefined },
    });
    expect(fetch.mock.calls[0]?.[0]).toBe(
      '/api/v1/reports?from=2026-10-01&projectId=a&projectId=b',
    );
  });
});
