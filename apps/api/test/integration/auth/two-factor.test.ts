import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  authenticatedResponseSchema,
  twoFactorEnabledResponseSchema,
  twoFactorSetupResponseSchema,
  UserRole,
} from '@tempo/shared';
import { generateTotp } from '../../../src/lib/totp.ts';
import {
  auditActions,
  bearer,
  body,
  createHarness,
  createUser,
  errorCode,
  login,
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
afterAll(async () => {
  await prisma().$disconnect();
});

async function challenge(email: string): Promise<string> {
  const res = await h.post('/login').send({ email, password: PASSWORD });
  expect(body(res)).toMatchObject({ status: 'two_factor_required' });
  return body<{ challengeToken: string }>(res).challengeToken;
}

describe('enrolling with an access token (optional 2FA)', () => {
  it('sets up, enables with a code, and returns 10 hashed recovery codes', async () => {
    await createUser({ email: 'lena@tempo.test' });
    const session = await login(h, 'lena@tempo.test');
    const auth = bearer(session.accessToken);

    const setup = twoFactorSetupResponseSchema.parse(
      (await h.post('/2fa/setup').set('Authorization', auth)).body,
    );
    expect(setup.otpauthUrl).toContain(`secret=${setup.secret}`);

    const stored = await prisma().user.findUniqueOrThrow({ where: { email: 'lena@tempo.test' } });
    expect(stored.totpSecretEncrypted).not.toContain(setup.secret);
    expect(stored.totpEnabledAt).toBeNull();

    expect(
      errorCode(await h.post('/2fa/enable').set('Authorization', auth).send({ code: '000000' })),
    ).toBe('INVALID_TWO_FACTOR_CODE');
    const enabled = await h
      .post('/2fa/enable')
      .set('Authorization', auth)
      .send({ code: generateTotp(setup.secret, h.now()) });
    const { recoveryCodes, session: newSession } = twoFactorEnabledResponseSchema.parse(
      enabled.body,
    );
    expect(recoveryCodes).toHaveLength(10);
    expect(newSession).toBeUndefined();

    const codes = await prisma().recoveryCode.findMany();
    expect(codes).toHaveLength(10);
    for (const code of recoveryCodes)
      expect(JSON.stringify(codes)).not.toContain(code.replace('-', ''));
    expect(await auditActions()).toContain('auth.2fa.enabled');

    expect((await h.post('/2fa/setup').set('Authorization', auth)).status).toBe(409);
  });
});

describe('login with 2FA', () => {
  beforeEach(async () => {
    await createUser({ email: 'lena@tempo.test', totpSecret: TOTP_SECRET });
  });

  it('requires a second step and issues the session only after a valid code', async () => {
    const res = await h.post('/login').send({ email: 'lena@tempo.test', password: PASSWORD });
    expect(refreshCookie(res)).toBeNull();
    const challengeToken = body<{ challengeToken: string }>(res).challengeToken;

    // The challenge token is not an access token.
    expect((await h.get('/me').set('Authorization', bearer(challengeToken))).status).toBe(401);

    const ok = await h.post('/login/2fa').send({ challengeToken, code: totpNow(h) });
    expect(ok.status).toBe(200);
    expect(authenticatedResponseSchema.parse(ok.body).user.twoFactorEnabled).toBe(true);
    expect(refreshCookie(ok)).not.toBeNull();
  });

  it('rejects a wrong code and counts it towards the lockout', async () => {
    const challengeToken = await challenge('lena@tempo.test');
    const wrong = totpNow(h) === '123456' ? '654321' : '123456';
    const res = await h.post('/login/2fa').send({ challengeToken, code: wrong });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('INVALID_TWO_FACTOR_CODE');
    expect(
      (await prisma().user.findUniqueOrThrow({ where: { email: 'lena@tempo.test' } }))
        .failedLoginCount,
    ).toBe(1);
    expect(await auditActions()).toContain('auth.2fa.failed');
  });

  it('locks out after repeated wrong codes, even with a correct one afterwards', async () => {
    const challengeToken = await challenge('lena@tempo.test');
    const wrong = totpNow(h) === '123456' ? '654321' : '123456';
    for (let i = 0; i < 5; i++) await h.post('/login/2fa').send({ challengeToken, code: wrong });
    const res = await h.post('/login/2fa').send({ challengeToken, code: totpNow(h) });
    expect(res.status).toBe(429);
  });

  it('never accepts the same code twice (replay)', async () => {
    const code = totpNow(h);
    expect(
      (
        await h
          .post('/login/2fa')
          .send({ challengeToken: await challenge('lena@tempo.test'), code })
      ).status,
    ).toBe(200);
    const replay = await h
      .post('/login/2fa')
      .send({ challengeToken: await challenge('lena@tempo.test'), code });
    expect(replay.status).toBe(401);

    h.advance(30_000);
    const next = await h
      .post('/login/2fa')
      .send({ challengeToken: await challenge('lena@tempo.test'), code: totpNow(h) });
    expect(next.status).toBe(200);
  });

  it('expires the challenge after 5 minutes', async () => {
    const challengeToken = await challenge('lena@tempo.test');
    h.advance(5 * 60_000);
    const res = await h.post('/login/2fa').send({ challengeToken, code: totpNow(h) });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('INVALID_TOKEN');
  });

  it('requires exactly one of code or recoveryCode', async () => {
    const challengeToken = await challenge('lena@tempo.test');
    expect(errorCode(await h.post('/login/2fa').send({ challengeToken }))).toBe('VALIDATION_ERROR');
    expect(
      errorCode(
        await h
          .post('/login/2fa')
          .send({ challengeToken, code: totpNow(h), recoveryCode: 'abcde-fghij' }),
      ),
    ).toBe('VALIDATION_ERROR');
  });
});

describe('recovery codes', () => {
  it('each works exactly once, in any case/format', async () => {
    await createUser({ email: 'lena@tempo.test' });
    const session = await login(h, 'lena@tempo.test');
    const auth = bearer(session.accessToken);
    const { secret } = twoFactorSetupResponseSchema.parse(
      (await h.post('/2fa/setup').set('Authorization', auth)).body,
    );
    const { recoveryCodes } = twoFactorEnabledResponseSchema.parse(
      (
        await h
          .post('/2fa/enable')
          .set('Authorization', auth)
          .send({ code: generateTotp(secret, h.now()) })
      ).body,
    );
    const code = recoveryCodes[0] ?? '';

    const first = await h.post('/login/2fa').send({
      challengeToken: await challenge('lena@tempo.test'),
      recoveryCode: ` ${code.toUpperCase()} `,
    });
    expect(first.status).toBe(200);
    const again = await h
      .post('/login/2fa')
      .send({ challengeToken: await challenge('lena@tempo.test'), recoveryCode: code });
    expect(again.status).toBe(401);

    expect(await prisma().recoveryCode.count({ where: { usedAt: null } })).toBe(9);
    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'auth.2fa.recovery_code_used' },
    });
    expect(audit.after).toEqual({ remaining: 9 });
  });
});

describe('disabling 2FA', () => {
  it('needs the password and a current code', async () => {
    await createUser({ email: 'lena@tempo.test', totpSecret: TOTP_SECRET });
    const res = await h
      .post('/login/2fa')
      .send({ challengeToken: await challenge('lena@tempo.test'), code: totpNow(h) });
    const auth = bearer(authenticatedResponseSchema.parse(res.body).accessToken);
    h.advance(30_000);

    expect(
      (
        await h
          .post('/2fa/disable')
          .set('Authorization', auth)
          .send({ password: 'wrong password!!', code: totpNow(h) })
      ).status,
    ).toBe(401);
    expect(
      (
        await h
          .post('/2fa/disable')
          .set('Authorization', auth)
          .send({ password: PASSWORD, code: totpNow(h) })
      ).status,
    ).toBe(204);
    expect(await auditActions()).toContain('auth.2fa.disabled');
    expect(
      body(await h.post('/login').send({ email: 'lena@tempo.test', password: PASSWORD })),
    ).toMatchObject({
      status: 'authenticated',
    });
  });

  it('is not allowed for Super Admins', async () => {
    await createUser({
      email: 'admin@tempo.test',
      role: UserRole.SUPER_ADMIN,
      totpSecret: TOTP_SECRET,
    });
    const res = await h
      .post('/login/2fa')
      .send({ challengeToken: await challenge('admin@tempo.test'), code: totpNow(h) });
    const auth = bearer(authenticatedResponseSchema.parse(res.body).accessToken);
    h.advance(30_000);
    const disable = await h
      .post('/2fa/disable')
      .set('Authorization', auth)
      .send({ password: PASSWORD, code: totpNow(h) });
    expect(disable.status).toBe(403);
  });
});

describe('Super Admin forced enrolment', () => {
  beforeEach(async () => {
    await createUser({ email: 'admin@tempo.test', role: UserRole.SUPER_ADMIN });
  });

  async function setupToken(): Promise<string> {
    const res = await h.post('/login').send({ email: 'admin@tempo.test', password: PASSWORD });
    return body<{ setupToken: string }>(res).setupToken;
  }

  it('completes login once 2FA is enabled with the setup token', async () => {
    const auth = bearer(await setupToken());
    const { secret } = twoFactorSetupResponseSchema.parse(
      (await h.post('/2fa/setup').set('Authorization', auth)).body,
    );
    const res = await h
      .post('/2fa/enable')
      .set('Authorization', auth)
      .send({ code: generateTotp(secret, h.now()) });

    const parsed = twoFactorEnabledResponseSchema.parse(res.body);
    expect(parsed.recoveryCodes).toHaveLength(10);
    expect(parsed.session?.user).toMatchObject({ role: 'SUPER_ADMIN', twoFactorEnabled: true });
    expect(refreshCookie(res)).not.toBeNull();
    expect(
      (await h.get('/me').set('Authorization', bearer(parsed.session?.accessToken ?? ''))).status,
    ).toBe(200);
  });

  it('the setup token only works for the 2FA setup routes', async () => {
    const auth = bearer(await setupToken());
    expect((await h.get('/me').set('Authorization', auth)).status).toBe(401);
    expect(
      (
        await h
          .api()
          .post('/users/invites')
          .set('Authorization', auth)
          .send({ email: 'x@tempo.test', role: 'WORKER' })
      ).status,
    ).toBe(401);
    expect((await h.post('/logout-all').set('Authorization', auth)).status).toBe(401);
  });

  it('expires after 15 minutes', async () => {
    const auth = bearer(await setupToken());
    h.advance(15 * 60_000);
    expect((await h.post('/2fa/setup').set('Authorization', auth)).status).toBe(401);
  });

  it('existing sessions stop working if a Super Admin loses 2FA', async () => {
    const auth = bearer(await setupToken());
    const { secret } = twoFactorSetupResponseSchema.parse(
      (await h.post('/2fa/setup').set('Authorization', auth)).body,
    );
    const enabled = twoFactorEnabledResponseSchema.parse(
      (
        await h
          .post('/2fa/enable')
          .set('Authorization', auth)
          .send({ code: generateTotp(secret, h.now()) })
      ).body,
    );
    await prisma().user.update({
      where: { email: 'admin@tempo.test' },
      data: { totpEnabledAt: null },
    });
    const res = await h.get('/me').set('Authorization', bearer(enabled.session?.accessToken ?? ''));
    expect(res.status).toBe(403);
    expect(errorCode(res)).toBe('TWO_FACTOR_REQUIRED');
  });
});
