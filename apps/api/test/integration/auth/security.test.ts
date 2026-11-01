import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { authenticatedResponseSchema } from '@tempo/shared';
import {
  bearer,
  body,
  cookieHeader,
  createHarness,
  createUser,
  PASSWORD,
  prisma,
  refreshCookie,
  resetDatabase,
  TOTP_SECRET,
  totpNow,
  type Harness,
} from './harness.ts';

let h: Harness;

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
});
afterEach(async () => {
  await h.drainBackground();
});
afterAll(async () => {
  await prisma().$disconnect();
});

describe('secrets never reach logs or audit rows', () => {
  it('across login, 2FA, refresh, reset and logout', async () => {
    await createUser({ email: 'lena@tempo.test', totpSecret: TOTP_SECRET });
    const secrets: string[] = [PASSWORD, TOTP_SECRET];

    const first = await h.post('/login').send({ email: 'lena@tempo.test', password: PASSWORD });
    const challengeToken = body<{ challengeToken: string }>(first).challengeToken;
    const code = totpNow(h);
    const second = await h.post('/login/2fa').send({ challengeToken, code });
    const session = authenticatedResponseSchema.parse(second.body);
    const refresh = refreshCookie(second)?.value ?? '';
    const rotated = await h.post('/refresh').set('Cookie', cookieHeader(refresh));
    const rotatedCookie = refreshCookie(rotated)?.value ?? '';
    await h.get('/me').set('Authorization', bearer(session.accessToken));
    await h.post('/password/forgot').send({ email: 'lena@tempo.test' });
    await h.drainBackground();
    const resetToken =
      /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.messages.at(-1)?.text ?? '')?.[1] ?? '';
    await h
      .post('/password/reset')
      .send({ token: resetToken, password: 'a brand new long passphrase' });
    await h.post('/logout').set('Cookie', cookieHeader(rotatedCookie));

    secrets.push(
      challengeToken,
      code,
      session.accessToken,
      refresh,
      rotatedCookie,
      resetToken,
      'a brand new long passphrase',
    );
    const logs = h.logLines.join('\n');
    const audit = JSON.stringify(await prisma().auditLog.findMany());
    expect(h.logLines.length).toBeGreaterThan(5);
    for (const secret of secrets) {
      expect(secret.length).toBeGreaterThan(5);
      expect(logs).not.toContain(secret);
      expect(audit).not.toContain(secret);
    }
  });
});

describe('CORS and Origin', () => {
  it('lets the web app read auth responses cross-origin with credentials', async () => {
    await createUser({ email: 'lena@tempo.test' });
    const res = await h.post('/login').send({ email: 'lena@tempo.test', password: PASSWORD });
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('every cookie endpoint enforces the Origin allowlist', async () => {
    for (const path of [
      '/login',
      '/login/2fa',
      '/refresh',
      '/logout',
      '/logout-all',
      '/invites/accept',
      '/2fa/enable',
    ]) {
      const res = await h.post(path).set('Origin', 'https://evil.example').send({});
      expect(res.status, path).toBe(403);
    }
  });
});

describe('responses', () => {
  it('auth responses are never cached', async () => {
    const res = await h.post('/login').send({ email: 'x@tempo.test', password: 'x' });
    expect(res.headers['cache-control']).toBe('no-store');
  });
});
