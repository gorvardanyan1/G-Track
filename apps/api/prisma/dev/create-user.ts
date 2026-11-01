import {
  checkPasswordPolicy,
  emailSchema,
  isValidTimeZone,
  PASSWORD_ISSUE_MESSAGES,
  UserRole,
} from '@tempo/shared';
import type { PrismaClient } from '../../src/db/prisma.ts';
import { hashPassword } from '../../src/lib/password.ts';

export interface LocalUserInput {
  email: string;
  name: string;
  role: UserRole;
  password: string;
  /** IANA zone; defaults to the organization's default timezone. */
  timezone?: string;
  /** Project names to join: PMs as the project's PM, everyone else as a worker. */
  projects?: string[];
  hourlyRate?: number | null;
  /** Skip the password rules (local testing only; the app itself never accepts such passwords). */
  allowWeakPassword?: boolean;
}

export class CreateUserError extends Error {}

/**
 * Creates a ready-to-use account directly in the database, for local development (the app
 * itself only creates people through invitations). Super Admins still enrol 2FA at first login.
 */
export async function createLocalUser(prisma: PrismaClient, input: LocalUserInput) {
  const email = emailSchema.safeParse(input.email);
  if (!email.success) throw new CreateUserError(`Not a valid email: ${input.email}`);
  const name = input.name.trim();
  if (!name || name.length > 100) throw new CreateUserError('The name must be 1–100 characters');

  const issues = checkPasswordPolicy(input.password, { email: email.data, name });
  if (issues.length > 0 && !input.allowWeakPassword) {
    throw new CreateUserError(
      `The password breaks the password rules:\n${issues.map((i) => `  - ${PASSWORD_ISSUE_MESSAGES[i]}`).join('\n')}\n` +
        'Choose another, or pass --allow-weak-password (local testing only).',
    );
  }

  const settings = await prisma.orgSettings.findUnique({ where: { id: 1 } });
  const timezone = input.timezone ?? settings?.defaultTimezone ?? 'UTC';
  if (!isValidTimeZone(timezone)) throw new CreateUserError(`Unknown timezone: ${timezone}`);

  if (await prisma.user.findUnique({ where: { email: email.data } }))
    throw new CreateUserError(`A user with ${email.data} already exists`);

  const projects: { id: string; name: string }[] = [];
  for (const projectName of input.projects ?? []) {
    const matches = await prisma.project.findMany({ where: { name: projectName } });
    if (matches.length !== 1)
      throw new CreateUserError(
        matches.length === 0
          ? `No project named "${projectName}"`
          : `Several projects are named "${projectName}"`,
      );
    projects.push(matches[0]!);
  }
  if (projects.length > 0 && input.role === UserRole.SUPER_ADMIN)
    throw new CreateUserError('Super Admins see every project already; leave out --project');

  const passwordHash = await hashPassword(input.password);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: email.data, name, role: input.role, timezone, passwordHash },
    });
    for (const project of projects) {
      await tx.projectMember.create({
        data: {
          projectId: project.id,
          userId: user.id,
          roleInProject: input.role === UserRole.PROJECT_MANAGER ? 'PM' : 'WORKER',
          hourlyRate: input.hourlyRate ?? null,
        },
      });
    }
    return { user, projects: projects.map((p) => p.name), weakPassword: issues.length > 0 };
  });
}
