import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { authenticatedResponseSchema, loginResponseSchema, UserRole } from '@tempo/shared';
import {
  auditActions,
  bearer,
  body,
  createHarness,
  createUser,
  errorCode,
  PASSWORD,
  prisma,
  refreshCookie,
  resetDatabase,
  type Harness,
} from './harness.ts';

let h: Harness;

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  await createUser({ email: 'lena@tempo.test', name: 'Lena Fischer' });
});
afterAll(async () => {
  await prisma().$disconnect();
});

describe('POST /auth/login', () => {
  it('returns an access token and sets a hardened refresh cookie', async () => {
    const res = await h.post('/login').send({ email: 'lena@tempo.test', password: PASSWORD });

    expect(res.status).toBe(200);
    const parsed = authenticatedResponseSchema.parse(res.body);
    expect(parsed.user).toMatchObject({
      email: 'lena@tempo.test',
      role: 'WORKER',
      twoFactorEnabled: false,
    });
    expect(Date.parse(parsed.accessTokenExpiresAt) - h.now().getTime()).toBe(15 * 60_000);

    const cookie = refreshCookie(res);
    expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(cookie?.attributes).toEqual(
      expect.arrayContaining(['Path=/api/v1/auth', 'HttpOnly', 'Secure', 'SameSite=Strict']),
    );
    expect(JSON.stringify(res.body)).not.toContain(cookie?.value);
  });

  it('stores only a hash of the refresh token', async () => {
    const res = await h.post('/login').send({ email: 'lena@tempo.test', password: PASSWORD });
    const raw = refreshCookie(res)?.value ?? '';
    const stored = await prisma().refreshToken.findFirstOrThrow();
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.tokenHash).not.toBe(raw);
  });

  it('gives an access token that works on /auth/me', async () => {
    const login = await h.post('/login').send({ email: 'lena@tempo.test', password: PASSWORD });
    const res = await h
      .get('/me')
      .set('Authorization', bearer(body<{ accessToken: string }>(login).accessToken));
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({ email: 'lena@tempo.test', name: 'Lena Fischer' });
  });

  it('normalizes the email (case and whitespace)', async () => {
    const res = await h.post('/login').send({ email: '  Lena@TEMPO.test ', password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it('answers a wrong password and an unknown email identically', async () => {
    const wrong = await h
      .post('/login')
      .send({ email: 'lena@tempo.test', password: 'wrong password here' });
    const unknown = await h
      .post('/login')
      .send({ email: 'nobody@tempo.test', password: 'wrong password here' });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual({
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' },
      });
      expect(refreshCookie(res)).toBeNull();
    }
  });

  it('audits successful and failed logins without secrets', async () => {
    await h.post('/login').send({ email: 'lena@tempo.test', password: 'wrong password here' });
    await h.post('/login').send({ email: 'ghost@tempo.test', password: 'wrong password here' });
    await h.post('/login').send({ email: 'lena@tempo.test', password: PASSWORD });

    expect(await auditActions()).toEqual([
      'auth.login.failed',
      'auth.login.failed',
      'auth.login.succeeded',
    ]);
    const rows = await prisma().auditLog.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(rows[0]?.after).toMatchObject({
      email: 'lena@tempo.test',
      reason: 'bad_password',
      failedCount: 1,
    });
    expect(rows[1]).toMatchObject({
      actorId: null,
      after: { email: 'ghost@tempo.test', reason: 'unknown_email' },
    });
    expect(rows[2]?.ip).toBeTruthy();
    expect(JSON.stringify(rows)).not.toMatch(/wrong password|correct horse/);
  });

  it('refuses deactivated accounts, but only after the password is proven', async () => {
    await createUser({ email: 'gone@tempo.test', isActive: false });
    const wrong = await h
      .post('/login')
      .send({ email: 'gone@tempo.test', password: 'wrong password here' });
    expect(errorCode(wrong)).toBe('INVALID_CREDENTIALS');
    const right = await h.post('/login').send({ email: 'gone@tempo.test', password: PASSWORD });
    expect(right.status).toBe(403);
    expect(errorCode(right)).toBe('ACCOUNT_DISABLED');
  });

  it('validates input and strips unknown fields', async () => {
    expect(errorCode(await h.post('/login').send({ email: 'not-an-email', password: 'x' }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(errorCode(await h.post('/login').send({}))).toBe('VALIDATION_ERROR');
    const res = await h
      .post('/login')
      .send({ email: 'lena@tempo.test', password: PASSWORD, role: 'SUPER_ADMIN' });
    expect(body<{ user: { role: string } }>(res).user.role).toBe('WORKER');
  });

  describe('Origin check (CSRF)', () => {
    it('rejects requests without an Origin header', async () => {
      const res = await h
        .post('/login')
        .unset('Origin')
        .send({ email: 'lena@tempo.test', password: PASSWORD });
      expect(res.status).toBe(403);
    });

    it('rejects foreign origins', async () => {
      const res = await h
        .post('/login')
        .set('Origin', 'https://evil.example')
        .send({ email: 'lena@tempo.test', password: PASSWORD });
      expect(res.status).toBe(403);
      expect(refreshCookie(res)).toBeNull();
    });
  });
});

describe('lockout with backoff', () => {
  const fail = (email = 'lena@tempo.test') =>
    h.post('/login').send({ email, password: 'wrong password here' });

  it('locks after 5 failures, even for the correct password, and backs off exponentially', async () => {
    for (let i = 0; i < 4; i++) expect((await fail()).status).toBe(401);
    expect((await fail()).status).toBe(401); // 5th failure triggers the 1-minute lock

    const locked = await h.post('/login').send({ email: 'lena@tempo.test', password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.headers['retry-after']).toBe('60');

    h.advance(60_000);
    expect((await fail()).status).toBe(401); // 6th failure → 2 minutes
    h.advance(60_000);
    expect(
      (await h.post('/login').send({ email: 'lena@tempo.test', password: PASSWORD })).status,
    ).toBe(429);
    h.advance(60_000);
    expect(
      (await h.post('/login').send({ email: 'lena@tempo.test', password: PASSWORD })).status,
    ).toBe(200);

    const user = await prisma().user.findUniqueOrThrow({ where: { email: 'lena@tempo.test' } });
    expect(user).toMatchObject({ failedLoginCount: 0, lockedUntil: null });
    expect(await auditActions()).toContain('auth.account.locked');
  });

  it('treats unknown emails the same way, so lockout reveals nothing', async () => {
    for (let i = 0; i < 5; i++) await fail('ghost@tempo.test');
    const res = await fail('ghost@tempo.test');
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBe('60');
  });

  it('does not lock other accounts', async () => {
    await createUser({ email: 'jonas@tempo.test' });
    for (let i = 0; i < 5; i++) await fail();
    expect(
      (await h.post('/login').send({ email: 'jonas@tempo.test', password: PASSWORD })).status,
    ).toBe(200);
  });
});

describe('rate limiting', () => {
  it('limits login attempts per email, independent of lockout', async () => {
    // Successful logins never trigger the lockout, so only the rate limiter can answer 429.
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      statuses.push(
        (await h.post('/login').send({ email: 'lena@tempo.test', password: PASSWORD })).status,
      );
    }
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);

    h.advance(15 * 60_000);
    expect(
      (await h.post('/login').send({ email: 'lena@tempo.test', password: PASSWORD })).status,
    ).toBe(200);
  });

  it('limits login attempts per IP across emails', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++) {
      statuses.push(
        (await h.post('/login').send({ email: `user${i}@tempo.test`, password: 'x' })).status,
      );
    }
    expect(statuses.slice(0, 30).every((s) => s === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
  });
});

describe('super admin', () => {
  it('must enrol in 2FA before getting a session', async () => {
    await createUser({ email: 'admin@tempo.test', role: UserRole.SUPER_ADMIN });
    const res = await h.post('/login').send({ email: 'admin@tempo.test', password: PASSWORD });
    expect(res.status).toBe(200);
    const outcome = loginResponseSchema.parse(res.body);
    expect(outcome.status).toBe('two_factor_setup_required');
    expect(Object.keys(res.body as object).sort()).toEqual(['setupToken', 'status']);
    expect(refreshCookie(res)).toBeNull();
    expect(await prisma().refreshToken.count()).toBe(0);
  });
});
