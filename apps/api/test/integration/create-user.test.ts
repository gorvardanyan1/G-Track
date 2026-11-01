import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { authenticatedResponseSchema, loginResponseSchema, UserRole } from '@tempo/shared';
import { createLocalUser, CreateUserError } from '../../prisma/dev/create-user.ts';
import { createHarness, prisma, resetDatabase } from './auth/harness.ts';

beforeEach(async () => {
  await resetDatabase();
  await prisma().project.create({ data: { name: 'Fleet Dashboard', color: '#5B5BF7' } });
});
afterAll(async () => {
  await prisma().$disconnect();
});

describe('createLocalUser (local dev accounts)', () => {
  it('creates users who can sign in, with project access by role', async () => {
    const pm = await createLocalUser(prisma(), {
      email: 'PM@Tempo.test',
      name: 'Pat Manager',
      role: UserRole.PROJECT_MANAGER,
      password: 'violet tram under the rain',
      timezone: 'Europe/Berlin',
      projects: ['Fleet Dashboard'],
    });
    expect(pm.user).toMatchObject({
      email: 'pm@tempo.test',
      role: 'PROJECT_MANAGER',
      timezone: 'Europe/Berlin',
    });
    expect(pm.user.passwordHash).toMatch(/^\$argon2id\$/);
    const membership = await prisma().projectMember.findFirstOrThrow({
      where: { userId: pm.user.id },
    });
    expect(membership.roleInProject).toBe('PM');

    const h = createHarness();
    const res = await h
      .post('/login')
      .send({ email: 'pm@tempo.test', password: 'violet tram under the rain' });
    expect(authenticatedResponseSchema.parse(res.body).user.role).toBe('PROJECT_MANAGER');
  });

  it('refuses weak passwords unless explicitly allowed, and they still work for sign-in', async () => {
    await expect(
      createLocalUser(prisma(), {
        email: 'w@tempo.test',
        name: 'Weak',
        role: UserRole.WORKER,
        password: 'admin2024!',
      }),
    ).rejects.toThrow(/at least 12 characters/);

    const created = await createLocalUser(prisma(), {
      email: 'w@tempo.test',
      name: 'Weak',
      role: UserRole.WORKER,
      password: 'admin2024!',
      allowWeakPassword: true,
      projects: ['Fleet Dashboard'],
    });
    expect(created.weakPassword).toBe(true);
    const res = await createHarness()
      .post('/login')
      .send({ email: 'w@tempo.test', password: 'admin2024!' });
    expect(res.status).toBe(200);
  });

  it('sends a new Super Admin to 2FA enrolment at first sign-in', async () => {
    await createLocalUser(prisma(), {
      email: 'boss@tempo.test',
      name: 'Boss',
      role: UserRole.SUPER_ADMIN,
      password: 'violet tram under the rain',
    });
    const res = await createHarness()
      .post('/login')
      .send({ email: 'boss@tempo.test', password: 'violet tram under the rain' });
    expect(loginResponseSchema.parse(res.body).status).toBe('two_factor_setup_required');
  });

  it('rejects duplicates, unknown projects and timezones, and bad emails', async () => {
    const base = { name: 'X', role: UserRole.WORKER, password: 'violet tram under the rain' };
    await createLocalUser(prisma(), { ...base, email: 'dup@tempo.test' });
    await expect(createLocalUser(prisma(), { ...base, email: 'DUP@tempo.test' })).rejects.toThrow(
      /already exists/,
    );
    await expect(
      createLocalUser(prisma(), { ...base, email: 'a@tempo.test', projects: ['Nope'] }),
    ).rejects.toThrow(/No project named "Nope"/);
    await expect(
      createLocalUser(prisma(), { ...base, email: 'b@tempo.test', timezone: 'Mars/Base' }),
    ).rejects.toThrow(CreateUserError);
    await expect(createLocalUser(prisma(), { ...base, email: 'not-an-email' })).rejects.toThrow(
      /valid email/,
    );
    // Nothing half-created.
    expect(await prisma().user.count()).toBe(1);
  });
});
