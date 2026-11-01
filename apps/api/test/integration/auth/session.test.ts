import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { authenticatedResponseSchema } from '@tempo/shared';
import {
  auditActions,
  bearer,
  cookieHeader,
  createHarness,
  createUser,
  errorCode,
  login,
  prisma,
  refreshCookie,
  resetDatabase,
  type Harness,
} from './harness.ts';

let h: Harness;

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  await createUser({ email: 'lena@tempo.test' });
});
afterAll(async () => {
  await prisma().$disconnect();
});

const refresh = (token: string) => h.post('/refresh').set('Cookie', cookieHeader(token));
const me = (accessToken: string) => h.get('/me').set('Authorization', bearer(accessToken));

describe('POST /auth/refresh', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const session = await login(h, 'lena@tempo.test');
    h.advance(60_000);
    const res = await refresh(session.refreshToken);

    expect(res.status).toBe(200);
    const parsed = authenticatedResponseSchema.parse(res.body);
    const next = refreshCookie(res);
    expect(next?.value).toBeDefined();
    expect(next?.value).not.toBe(session.refreshToken);
    expect((await me(parsed.accessToken)).status).toBe(200);

    const tokens = await prisma().refreshToken.findMany({ orderBy: { createdAt: 'asc' } });
    expect(tokens).toHaveLength(2);
    expect(tokens[0]?.familyId).toBe(tokens[1]?.familyId);
    expect(tokens[0]?.replacedById).toBe(tokens[1]?.id);
    expect(tokens[0]?.revokedAt).not.toBeNull();
  });

  it('detects reuse of a rotated token and revokes the whole session family', async () => {
    const session = await login(h, 'lena@tempo.test');
    const rotated = await refresh(session.refreshToken);
    const current = refreshCookie(rotated)?.value ?? '';
    const currentAccess = authenticatedResponseSchema.parse(rotated.body).accessToken;

    // An attacker replays the stolen original after the grace window.
    h.advance(11_000);
    const replay = await refresh(session.refreshToken);
    expect(replay.status).toBe(401);
    expect(errorCode(replay)).toBe('INVALID_TOKEN');
    expect(refreshCookie(replay)?.value).toBe(''); // cookie cleared

    // The legitimate user's newer token and access token are dead too.
    expect((await refresh(current)).status).toBe(401);
    expect((await me(currentAccess)).status).toBe(401);
    expect(await prisma().refreshToken.count({ where: { revokedAt: null } })).toBe(0);
    expect(await auditActions()).toContain('auth.refresh_token.reuse_detected');
  });

  it('treats a near-simultaneous second refresh (two tabs) as a conflict, not an attack', async () => {
    const session = await login(h, 'lena@tempo.test');
    const first = await refresh(session.refreshToken);
    h.advance(2000);
    const second = await refresh(session.refreshToken);

    expect(second.status).toBe(409);
    expect(refreshCookie(second)).toBeNull();
    const latest = refreshCookie(first)?.value ?? '';
    expect((await refresh(latest)).status).toBe(200);
    expect(await auditActions()).not.toContain('auth.refresh_token.reuse_detected');
  });

  it('lets only one of two concurrent refreshes win', async () => {
    const session = await login(h, 'lena@tempo.test');
    const results = await Promise.all([
      refresh(session.refreshToken),
      refresh(session.refreshToken),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409]);
    expect(await prisma().refreshToken.count({ where: { revokedAt: null } })).toBe(1);
  });

  it('rejects expired refresh tokens', async () => {
    const session = await login(h, 'lena@tempo.test');
    h.advance(14 * 86_400_000);
    expect((await refresh(session.refreshToken)).status).toBe(401);
  });

  it('rejects missing, unknown and malformed cookies', async () => {
    expect((await h.post('/refresh')).status).toBe(401);
    expect((await refresh('x'.repeat(43))).status).toBe(401);
    expect((await refresh('not a token;')).status).toBe(401);
  });

  it('requires an allowed Origin', async () => {
    const session = await login(h, 'lena@tempo.test');
    const res = await h
      .post('/refresh')
      .unset('Origin')
      .set('Cookie', cookieHeader(session.refreshToken));
    expect(res.status).toBe(403);
  });

  it('ends the session of a deactivated user', async () => {
    const session = await login(h, 'lena@tempo.test');
    await prisma().user.update({ where: { email: 'lena@tempo.test' }, data: { isActive: false } });
    expect((await refresh(session.refreshToken)).status).toBe(401);
    expect((await me(session.accessToken)).status).toBe(401);
  });
});

describe('access tokens', () => {
  it('expire after 15 minutes', async () => {
    const session = await login(h, 'lena@tempo.test');
    h.advance(15 * 60_000 - 1000);
    expect((await me(session.accessToken)).status).toBe(200);
    h.advance(1000);
    expect((await me(session.accessToken)).status).toBe(401);
  });

  it('are rejected when missing, malformed or tampered with', async () => {
    const session = await login(h, 'lena@tempo.test');
    expect((await h.get('/me')).status).toBe(401);
    expect((await h.get('/me').set('Authorization', 'Basic abc')).status).toBe(401);
    const [header, payload, sig] = session.accessToken.split('.');
    const flipped = `${header}.${payload}.${sig?.startsWith('A') ? 'B' : 'A'}${sig?.slice(1)}`;
    expect((await me(flipped)).status).toBe(401);
  });

  it('reflect role changes immediately (role is read from the database)', async () => {
    const session = await login(h, 'lena@tempo.test');
    await prisma().user.update({
      where: { email: 'lena@tempo.test' },
      data: { role: 'PROJECT_MANAGER' },
    });
    const res = await me(session.accessToken);
    expect((res.body as { role: string }).role).toBe('PROJECT_MANAGER');
  });
});

describe('logout', () => {
  it('ends the current session and clears the cookie, leaving other sessions alone', async () => {
    const laptop = await login(h, 'lena@tempo.test');
    const phone = await login(h, 'lena@tempo.test');

    const res = await h.post('/logout').set('Cookie', cookieHeader(laptop.refreshToken));
    expect(res.status).toBe(204);
    expect(refreshCookie(res)?.value).toBe('');

    expect((await refresh(laptop.refreshToken)).status).toBe(401);
    expect((await me(laptop.accessToken)).status).toBe(401);
    expect((await me(phone.accessToken)).status).toBe(200);
    expect(await auditActions()).toContain('auth.logout');
  });

  it('is harmless without a session', async () => {
    expect((await h.post('/logout')).status).toBe(204);
  });

  it('logout-all ends every session of the user', async () => {
    const laptop = await login(h, 'lena@tempo.test');
    const phone = await login(h, 'lena@tempo.test');
    await createUser({ email: 'jonas@tempo.test' });
    const other = await login(h, 'jonas@tempo.test');

    const res = await h.post('/logout-all').set('Authorization', bearer(laptop.accessToken));
    expect(res.status).toBe(204);

    for (const s of [laptop, phone]) {
      expect((await me(s.accessToken)).status).toBe(401);
      expect((await refresh(s.refreshToken)).status).toBe(401);
    }
    expect((await me(other.accessToken)).status).toBe(200);
    expect(await auditActions()).toContain('auth.logout_all');
  });

  it('logout-all requires authentication', async () => {
    expect((await h.post('/logout-all')).status).toBe(401);
  });
});
