import type { ListUsersQuery } from '@tempo/shared';
import type { PrismaClient } from '../../db/prisma.ts';
import type { Prisma, UserRole } from '../../generated/prisma/client.ts';

/** App-wide advisory lock that serializes every change to who is an active Super Admin. */
const SUPER_ADMIN_LOCK = 734_001;

type Tx = Prisma.TransactionClient;

/**
 * Whether `id` is the only active Super Admin, decided under the lock, so two admins demoting
 * or deactivating each other at the same moment can't both succeed.
 */
async function isLastActiveSuperAdmin(tx: Tx, id: string): Promise<boolean> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SUPER_ADMIN_LOCK})`;
  const user = await tx.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
  if (user?.role !== 'SUPER_ADMIN' || !user.isActive) return false;
  return (await tx.user.count({ where: { role: 'SUPER_ADMIN', isActive: true } })) <= 1;
}

export function createUsersRepository(prisma: PrismaClient) {
  return {
    async list(query: ListUsersQuery) {
      const where: Prisma.UserWhereInput = {
        ...(query.role && { role: query.role }),
        ...(query.status !== 'all' && { isActive: query.status === 'active' }),
        ...(query.search && {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
          ],
        }),
      };
      const [items, total] = await prisma.$transaction([
        prisma.user.findMany({
          where,
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        prisma.user.count({ where }),
      ]);
      return { items, total };
    },

    findById: (id: string) => prisma.user.findUnique({ where: { id } }),

    /** Null when it would demote the last active Super Admin. */
    setRole: (id: string, role: UserRole) =>
      prisma.$transaction(async (tx) => {
        if (role !== 'SUPER_ADMIN' && (await isLastActiveSuperAdmin(tx, id))) return null;
        return tx.user.update({ where: { id }, data: { role } });
      }),

    /**
     * Deactivates the user, ends all their sessions and stops their timer, in one transaction.
     * Returns the stopped timer, if one was running; null for the last active Super Admin.
     */
    deactivate: (id: string, at: Date) =>
      prisma.$transaction(async (tx) => {
        if (await isLastActiveSuperAdmin(tx, id)) return null;
        const user = await tx.user.update({ where: { id }, data: { isActive: false } });
        await tx.refreshToken.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: at },
        });
        const stopped = await tx.$queryRaw<{ id: string; project_id: string }[]>`
          UPDATE time_entries
          SET ended_at = GREATEST(${at}::timestamptz, started_at + interval '1 second'),
              updated_at = ${at}
          WHERE user_id = ${id}::uuid AND ended_at IS NULL
          RETURNING id, project_id`;
        return { user, stoppedTimer: stopped[0] ?? null };
      }),

    activate: (id: string) =>
      prisma.user.update({
        where: { id },
        data: { isActive: true, failedLoginCount: 0, lockedUntil: null },
      }),

    listPendingInvites: (now: Date) =>
      prisma.invite.findMany({
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
        orderBy: { createdAt: 'desc' },
      }),

    findPendingInvite: (id: string, now: Date) =>
      prisma.invite.findFirst({
        where: { id, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      }),

    revokeInvite: (id: string, at: Date) =>
      prisma.invite.update({ where: { id }, data: { revokedAt: at } }),
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
