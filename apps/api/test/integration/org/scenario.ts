import { UserRole } from '@tempo/shared';
import { createUser, prisma, TOTP_SECRET, type Harness } from '../auth/harness.ts';

/**
 * A small organization:
 *   Project A (client Northwind): PM = pmA, worker = workerA (rate 80), task "Design"
 *   Project B (client Northwind): PM = pmB, worker = workerB, task "Build"
 *   Archived project (no client): PM = pmA, worker = workerA
 *   outsider: a worker on no project
 */
export async function createScenario(h: Harness) {
  const admin = await createUser({
    email: 'admin@tempo.test',
    role: UserRole.SUPER_ADMIN,
    name: 'Ada Admin',
    totpSecret: TOTP_SECRET,
  });
  const pmA = await createUser({
    email: 'pm.a@tempo.test',
    role: UserRole.PROJECT_MANAGER,
    name: 'Petra PM',
  });
  const pmB = await createUser({
    email: 'pm.b@tempo.test',
    role: UserRole.PROJECT_MANAGER,
    name: 'Marcus PM',
  });
  const workerA = await createUser({ email: 'worker.a@tempo.test', name: 'Anahit Worker' });
  const workerB = await createUser({ email: 'worker.b@tempo.test', name: 'Bob Worker' });
  const outsider = await createUser({ email: 'outsider@tempo.test', name: 'Olga Outsider' });

  const client = await prisma().client.create({ data: { name: 'Northwind' } });
  const projectA = await prisma().project.create({
    data: {
      name: 'Project A',
      color: '#5B5BF7',
      clientId: client.id,
      budgetHours: 100,
      members: {
        create: [
          { userId: pmA.id, roleInProject: 'PM' },
          { userId: workerA.id, roleInProject: 'WORKER', hourlyRate: 80 },
        ],
      },
      tasks: { create: [{ name: 'Design' }] },
    },
    include: { tasks: true },
  });
  const projectB = await prisma().project.create({
    data: {
      name: 'Project B',
      color: '#10B981',
      clientId: client.id,
      members: {
        create: [
          { userId: pmB.id, roleInProject: 'PM' },
          { userId: workerB.id, roleInProject: 'WORKER', hourlyRate: 90 },
        ],
      },
      tasks: { create: [{ name: 'Build' }] },
    },
    include: { tasks: true },
  });
  const archived = await prisma().project.create({
    data: {
      name: 'Old Project',
      color: '#F59E0B',
      archivedAt: new Date('2026-01-01T00:00:00Z'),
      members: {
        create: [
          { userId: pmA.id, roleInProject: 'PM' },
          { userId: workerA.id, roleInProject: 'WORKER' },
        ],
      },
    },
  });

  const users = { admin, pmA, pmB, workerA, workerB, outsider };
  const signers = Object.fromEntries(
    await Promise.all(
      Object.entries(users).map(async ([key, user]) => [key, await h.session(user.id)]),
    ),
  ) as Record<keyof typeof users, () => string>;
  /** Fresh access token at the current test time (the clock may have moved). */
  const token = (who: keyof typeof users) => signers[who]();

  return {
    users,
    token,
    client,
    projectA,
    projectB,
    archived,
    taskA: projectA.tasks[0]!,
    taskB: projectB.tasks[0]!,
    as: (who: keyof typeof users) => h.api(token(who)),
  };
}

export type Scenario = Awaited<ReturnType<typeof createScenario>>;
export type Role = keyof Scenario['users'];
