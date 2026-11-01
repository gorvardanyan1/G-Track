import type { PrismaClient } from '../../src/db/prisma.ts';
import { hashPassword } from '../../src/lib/password.ts';
import { CLIENTS, PROJECTS, USERS, WORKER_PROFILES } from './data.ts';
import { generateWorkerEntries, type WorkerAssignment } from './entries.ts';
import { createRandom } from './random.ts';

export interface SeedOptions {
  /** Password for every seeded user. */
  password: string;
  /** "Now" for the generated history; entries never extend past it. */
  now?: Date;
  weeks?: number;
  /** PRNG seed; same seed + same `now` = same data. */
  randomSeed?: number;
}

export interface SeedSummary {
  users: number;
  clients: number;
  projects: number;
  tasks: number;
  timeEntries: number;
  runningTimers: number;
}

function required<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`Seed data refers to unknown ${what}`);
  return value;
}

/** Wipes all application tables and inserts the demo data in one transaction. */
export async function runSeed(prisma: PrismaClient, options: SeedOptions): Promise<SeedSummary> {
  const now = options.now ?? new Date();
  const weeks = options.weeks ?? 6;
  const rng = createRandom(options.randomSeed ?? 20260101);

  // Hash outside the transaction: argon2 is deliberately slow. One hash per user (unique salts).
  const passwordHashes = await Promise.all(USERS.map(() => hashPassword(options.password)));

  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`
        TRUNCATE TABLE audit_logs, time_entries, timesheets, project_members, tasks, projects,
          clients, refresh_tokens, recovery_codes, password_resets, invites, org_settings, users
        RESTART IDENTITY CASCADE`;

      const userIds = new Map<string, string>();
      for (const [index, user] of USERS.entries()) {
        const created = await tx.user.create({
          data: {
            email: user.email,
            name: user.name,
            role: user.role,
            timezone: user.timezone,
            passwordHash: required(passwordHashes[index], 'password hash'),
          },
        });
        userIds.set(user.key, created.id);
      }
      const userId = (key: string) => required(userIds.get(key), `user "${key}"`);

      await tx.orgSettings.create({
        data: {
          name: 'TEMPO Demo',
          defaultTimezone: 'Europe/Berlin',
          weekStartDay: 1,
          roundingMinutes: 15,
          roundingMode: 'NEAREST',
          lockAfterDays: 30,
          updatedById: userId('admin'),
        },
      });

      const clientIds = new Map<string, string>();
      for (const client of CLIENTS) {
        const created = await tx.client.create({ data: { name: client.name } });
        clientIds.set(client.key, created.id);
      }

      const assignments = new Map<string, WorkerAssignment['projects'][number][]>();
      let taskCount = 0;
      for (const project of PROJECTS) {
        const created = await tx.project.create({
          data: {
            name: project.name,
            color: project.color,
            budgetHours: project.budgetHours,
            isBillable: project.isBillable,
            clientId: required(clientIds.get(project.clientKey), `client "${project.clientKey}"`),
            members: {
              create: [
                { userId: userId(project.pmKey), roleInProject: 'PM' },
                ...project.workerKeys.map((key) => ({
                  userId: userId(key),
                  roleInProject: 'WORKER' as const,
                  hourlyRate: project.hourlyRate,
                })),
              ],
            },
            tasks: { create: Object.keys(project.tasks).map((name) => ({ name })) },
          },
          include: { tasks: true },
        });
        taskCount += created.tasks.length;

        const tasks = created.tasks.map((task) => ({
          taskId: task.id,
          descriptions: required(project.tasks[task.name], `task "${task.name}"`),
        }));
        for (const key of project.workerKeys) {
          const list = assignments.get(key) ?? [];
          list.push({ projectId: created.id, isBillable: project.isBillable, tasks });
          assignments.set(key, list);
        }
      }

      const entries = USERS.filter((user) => user.role === 'WORKER').flatMap((user) =>
        generateWorkerEntries(
          {
            userId: userId(user.key),
            timezone: user.timezone,
            profile: required(WORKER_PROFILES[user.key], `worker profile "${user.key}"`),
            projects: required(assignments.get(user.key), `assignments for "${user.key}"`),
          },
          rng,
          now,
          weeks,
        ),
      );
      await tx.timeEntry.createMany({ data: entries });

      return {
        users: USERS.length,
        clients: CLIENTS.length,
        projects: PROJECTS.length,
        tasks: taskCount,
        timeEntries: entries.length,
        runningTimers: entries.filter((entry) => entry.endedAt === null).length,
      };
    },
    { timeout: 60_000 },
  );
}
