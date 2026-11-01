import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sha256Hex } from '../../../src/lib/tokens.ts';
import {
  auditActions,
  bearer,
  createHarness,
  createUser,
  errorCode,
  login,
  PASSWORD,
  prisma,
  resetDatabase,
  type Harness,
} from './harness.ts';

const NEW_PASSWORD = 'quiet lanterns over the spree';
let h: Harness;

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  await createUser({ email: 'lena@tempo.test', name: 'Lena Fischer' });
});
afterEach(async () => {
  await h.drainBackground();
});
afterAll(async () => {
  await prisma().$disconnect();
});

const forgot = (email: string) => h.post('/password/forgot').send({ email });
const reset = (token: string, password = NEW_PASSWORD) =>
  h.post('/password/reset').send({ token, password });

async function requestToken(): Promise<string> {
  await forgot('lena@tempo.test');
  await h.drainBackground();
  const match = /#token=([A-Za-z0-9_-]+)/.exec(h.mailer.messages.at(-1)?.text ?? '');
  if (!match?.[1]) throw new Error('no reset mail');
  return match[1];
}

describe('POST /auth/password/forgot', () => {
  it('responds identically whether or not the email exists', async () => {
    const known = await forgot('lena@tempo.test');
    const unknown = await forgot('nobody@tempo.test');
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body).toEqual(unknown.body);

    await h.drainBackground();
    expect(h.mailer.messages.map((m) => m.to)).toEqual(['lena@tempo.test']);
    expect(await auditActions()).toEqual([
      'auth.password_reset.requested',
      'auth.password_reset.requested',
    ]);
  });

  it('does not send mail to deactivated accounts', async () => {
    await createUser({ email: 'gone@tempo.test', isActive: false });
    await forgot('gone@tempo.test');
    await h.drainBackground();
    expect(h.mailer.messages).toHaveLength(0);
  });

  it('stores only a hash of the token and links via URL fragment', async () => {
    const token = await requestToken();
    expect(h.mailer.messages.at(-1)?.text).toContain(
      'https://app.tempo.test/reset-password#token=',
    );
    const stored = await prisma().passwordReset.findFirstOrThrow();
    expect(stored.tokenHash).toBe(sha256Hex(token));
    expect(stored.expiresAt.getTime() - h.now().getTime()).toBe(30 * 60_000);
  });

  it('is rate limited per email', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) statuses.push((await forgot('lena@tempo.test')).status);
    expect(statuses).toEqual([202, 202, 202, 429]);
  });
});

describe('POST /auth/password/reset', () => {
  it('sets the new password and ends every session', async () => {
    const session = await login(h, 'lena@tempo.test');
    const token = await requestToken();

    expect((await reset(token)).status).toBe(204);
    expect((await h.get('/me').set('Authorization', bearer(session.accessToken))).status).toBe(401);
    expect(
      (await h.post('/login').send({ email: 'lena@tempo.test', password: PASSWORD })).status,
    ).toBe(401);
    expect(
      (await h.post('/login').send({ email: 'lena@tempo.test', password: NEW_PASSWORD })).status,
    ).toBe(200);
    expect(await auditActions()).toContain('auth.password_reset.completed');
  });

  it('clears an active lockout', async () => {
    for (let i = 0; i < 5; i++)
      await h.post('/login').send({ email: 'lena@tempo.test', password: 'wrong password!' });
    await reset(await requestToken());
    expect(
      (await h.post('/login').send({ email: 'lena@tempo.test', password: NEW_PASSWORD })).status,
    ).toBe(200);
  });

  it('works only once', async () => {
    const token = await requestToken();
    expect((await reset(token)).status).toBe(204);
    expect(errorCode(await reset(token, 'another fine long passphrase'))).toBe('INVALID_TOKEN');
  });

  it('expires after 30 minutes', async () => {
    const token = await requestToken();
    h.advance(30 * 60_000);
    expect(errorCode(await reset(token))).toBe('INVALID_TOKEN');
  });

  it('is invalidated by a newer request', async () => {
    const first = await requestToken();
    const second = await requestToken();
    expect(errorCode(await reset(first))).toBe('INVALID_TOKEN');
    expect((await reset(second)).status).toBe(204);
  });

  it('enforces the password policy and keeps the token usable', async () => {
    const token = await requestToken();
    const weak = await reset(token, 'lena.fischer.berlin');
    expect(errorCode(weak)).toBe('PASSWORD_POLICY');
    expect((await reset(token)).status).toBe(204);
  });
});
