import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { authUserSchema } from '@tempo/shared';
import {
  auditActions,
  bearer,
  cookieHeader,
  createHarness,
  createUser,
  errorCode,
  login,
  PASSWORD,
  prisma,
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

describe('updating the profile', () => {
  it('changes name and timezone, audits only what changed', async () => {
    const { accessToken } = await login(h, 'lena@tempo.test');
    const res = await h.api(accessToken).patch('/auth/me').send({
      name: '  Lena F.  ',
      timezone: 'Asia/Yerevan',
      role: 'SUPER_ADMIN',
    });
    expect(res.status).toBe(200);
    expect(authUserSchema.parse(res.body)).toMatchObject({
      name: 'Lena F.',
      timezone: 'Asia/Yerevan',
      role: 'WORKER',
    });
    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'auth.profile_updated' },
    });
    expect(audit.before).toEqual({ name: 'Lena Fischer', timezone: 'Europe/Berlin' });
    expect(audit.after).toEqual({ name: 'Lena F.', timezone: 'Asia/Yerevan' });

    expect((await h.api(accessToken).patch('/auth/me').send({ name: 'Lena F.' })).status).toBe(200);
    expect(await prisma().auditLog.count({ where: { action: 'auth.profile_updated' } })).toBe(1);
  });

  it('rejects fixed offsets, empty names and empty bodies; needs a session', async () => {
    const { accessToken } = await login(h, 'lena@tempo.test');
    for (const body of [{ timezone: '+04:00' }, { timezone: 'Etc/GMT-4' }, { name: ' ' }, {}]) {
      expect(errorCode(await h.api(accessToken).patch('/auth/me').send(body))).toBe(
        'VALIDATION_ERROR',
      );
    }
    expect((await h.api().patch('/auth/me').send({ name: 'x' })).status).toBe(401);
  });
});

describe('changing the password', () => {
  const NEW = 'a brand new passphrase 2026';

  it('needs the current password, applies the policy, and signs out other sessions', async () => {
    const here = await login(h, 'lena@tempo.test');
    const elsewhere = await login(h, 'lena@tempo.test');
    const change = (body: object) => h.api(here.accessToken).post('/auth/password').send(body);

    expect(errorCode(await change({ currentPassword: 'wrong password', newPassword: NEW }))).toBe(
      'INVALID_CREDENTIALS',
    );
    expect(errorCode(await change({ currentPassword: PASSWORD, newPassword: 'short' }))).toBe(
      'PASSWORD_POLICY',
    );
    expect((await change({ currentPassword: PASSWORD, newPassword: NEW })).status).toBe(204);

    // This session keeps working; the other one is gone.
    expect((await h.get('/me').set('Authorization', bearer(here.accessToken))).status).toBe(200);
    expect((await h.get('/me').set('Authorization', bearer(elsewhere.accessToken))).status).toBe(
      401,
    );
    expect(
      (await h.post('/refresh').set('Cookie', cookieHeader(elsewhere.refreshToken))).status,
    ).toBe(401);

    expect((await h.post('/login').send({ email: 'lena@tempo.test', password: NEW })).status).toBe(
      200,
    );
    expect(await auditActions()).toContain('auth.password_changed');
    const audit = await prisma().auditLog.findFirstOrThrow({
      where: { action: 'auth.password_changed' },
    });
    expect(audit.after).toEqual({ otherSessionsRevoked: 1 });
    expect(JSON.stringify(await prisma().auditLog.findMany())).not.toContain(NEW);
  });
});
