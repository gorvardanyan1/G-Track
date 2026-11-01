import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { authenticatedResponseSchema, loginResponseSchema, UserRole } from '@tempo/shared';
import { sha256Hex } from '../../../src/lib/tokens.ts';
import {
  auditActions,
  body,
  createHarness,
  createUser,
  errorCode,
  login,
  prisma,
  refreshCookie,
  resetDatabase,
  TOTP_SECRET,
  totpNow,
  type Harness,
} from './harness.ts';

let h: Harness;
let adminToken: string;

/** Super Admin session (2FA enabled, as required). */
async function adminSession(): Promise<string> {
  await createUser({
    email: 'admin@tempo.test',
    role: UserRole.SUPER_ADMIN,
    totpSecret: TOTP_SECRET,
  });
  const first = await h
    .post('/login')
    .send({ email: 'admin@tempo.test', password: 'correct horse battery staple' });
  const { challengeToken } = body<{ challengeToken: string }>(first);
  const second = await h.post('/login/2fa').send({ challengeToken, code: totpNow(h) });
  return authenticatedResponseSchema.parse(second.body).accessToken;
}

const invite = (email: string, role: string = UserRole.WORKER, token = adminToken) =>
  h.api(token).post('/users/invites').send({ email, role });

function tokenFromMail(index = -1): string {
  const text = h.mailer.messages.at(index)?.text ?? '';
  const match = /#token=([A-Za-z0-9_-]+)/.exec(text);
  if (!match?.[1]) throw new Error(`no token in mail: ${text}`);
  return match[1];
}

const accept = (token: string, overrides: Record<string, unknown> = {}) =>
  h.post('/invites/accept').send({
    token,
    name: 'Anahit Petrosyan',
    password: 'violet tram under yerevan rain',
    timezone: 'Asia/Yerevan',
    ...overrides,
  });

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  adminToken = await adminSession();
});
afterAll(async () => {
  await prisma().$disconnect();
});

describe('creating invites', () => {
  it('emails a link with a token that is only stored hashed', async () => {
    const res = await invite('Anahit@Tempo.test');
    expect(res.status).toBe(201);
    expect(body(res)).toMatchObject({ email: 'anahit@tempo.test', role: 'WORKER' });
    expect(Date.parse(body<{ expiresAt: string }>(res).expiresAt) - h.now().getTime()).toBe(
      48 * 3_600_000,
    );

    const mail = h.mailer.messages.at(-1);
    expect(mail?.to).toBe('anahit@tempo.test');
    expect(mail?.text).toContain('https://app.tempo.test/accept-invite#token=');
    const token = tokenFromMail();
    const stored = await prisma().invite.findFirstOrThrow();
    expect(stored.tokenHash).toBe(sha256Hex(token));
    expect(JSON.stringify(stored)).not.toContain(token);
    expect(await auditActions()).toContain('auth.invite.created');
  });

  it('is hidden from PMs and workers (404) and requires authentication', async () => {
    await createUser({ email: 'pm@tempo.test', role: UserRole.PROJECT_MANAGER });
    await createUser({ email: 'worker@tempo.test' });
    for (const email of ['pm@tempo.test', 'worker@tempo.test']) {
      const session = await login(h, email);
      const res = await invite('new@tempo.test', UserRole.WORKER, session.accessToken);
      expect(res.status).toBe(404);
    }
    const anonymous = await h
      .api()
      .post('/users/invites')
      .send({ email: 'x@tempo.test', role: 'WORKER' });
    expect(anonymous.status).toBe(401);
    expect(h.mailer.messages).toHaveLength(0);
  });

  it('refuses emails that already have an account', async () => {
    const res = await invite('admin@tempo.test');
    expect(res.status).toBe(409);
  });

  it('invalidates the previous invite for the same email', async () => {
    await invite('anahit@tempo.test');
    const first = tokenFromMail();
    await invite('anahit@tempo.test', UserRole.PROJECT_MANAGER);
    const second = tokenFromMail();

    expect(errorCode(await accept(first))).toBe('INVALID_TOKEN');
    const res = await accept(second);
    expect(res.status).toBe(201);
    expect(body<{ user: { role: string } }>(res).user.role).toBe('PROJECT_MANAGER');
  });

  it('validates the role', async () => {
    expect(errorCode(await invite('x@tempo.test', 'OWNER'))).toBe('VALIDATION_ERROR');
  });
});

describe('accepting invites', () => {
  beforeEach(async () => {
    await invite('anahit@tempo.test');
  });

  it('shows who the invite is for', async () => {
    const res = await h.post('/invites/inspect').send({ token: tokenFromMail() });
    expect(res.status).toBe(200);
    expect(body(res)).toMatchObject({ email: 'anahit@tempo.test', role: 'WORKER' });
  });

  it('creates the account with the chosen timezone and signs the user in', async () => {
    const res = await accept(tokenFromMail());
    expect(res.status).toBe(201);
    const parsed = authenticatedResponseSchema.parse(res.body);
    expect(parsed.user).toMatchObject({
      email: 'anahit@tempo.test',
      name: 'Anahit Petrosyan',
      timezone: 'Asia/Yerevan',
    });
    expect(refreshCookie(res)).not.toBeNull();

    const user = await prisma().user.findUniqueOrThrow({ where: { email: 'anahit@tempo.test' } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await prisma().invite.findFirstOrThrow()).toMatchObject({ acceptedUserId: user.id });
    expect(await auditActions()).toContain('auth.invite.accepted');
  });

  it('can be used only once', async () => {
    const token = tokenFromMail();
    expect((await accept(token)).status).toBe(201);
    expect(errorCode(await accept(token, { name: 'Someone Else' }))).toBe('INVALID_TOKEN');
    expect(await prisma().user.count({ where: { email: 'anahit@tempo.test' } })).toBe(1);
  });

  it('expires after 48 hours', async () => {
    const token = tokenFromMail();
    h.advance(48 * 3_600_000);
    expect(errorCode(await accept(token))).toBe('INVALID_TOKEN');
    expect((await h.post('/invites/inspect').send({ token })).status).toBe(400);
  });

  it('enforces the password policy with field-level details', async () => {
    const res = await accept(tokenFromMail(), { password: 'anahit-2026-pass' });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('PASSWORD_POLICY');
    const details = (res.body as { error: { details: { code: string }[] } }).error.details;
    expect(details.map((d) => d.code)).toContain('CONTAINS_PERSONAL_INFO');
    expect(errorCode(await accept(tokenFromMail(), { password: 'short' }))).toBe('PASSWORD_POLICY');
    expect(await prisma().user.count({ where: { email: 'anahit@tempo.test' } })).toBe(0);
  });

  it('rejects invalid timezones and unknown tokens', async () => {
    expect(errorCode(await accept(tokenFromMail(), { timezone: '+04:00' }))).toBe(
      'VALIDATION_ERROR',
    );
    expect(errorCode(await accept('x'.repeat(43)))).toBe('INVALID_TOKEN');
  });

  it('sends invited Super Admins straight into 2FA enrolment', async () => {
    await invite('second.admin@tempo.test', UserRole.SUPER_ADMIN);
    const res = await accept(tokenFromMail(), { name: 'Second Admin' });
    expect(res.status).toBe(201);
    const outcome = loginResponseSchema.parse(res.body);
    expect(outcome.status).toBe('two_factor_setup_required');
    expect(Object.keys(res.body as object).sort()).toEqual(['setupToken', 'status']);
    expect(refreshCookie(res)).toBeNull();
  });
});
