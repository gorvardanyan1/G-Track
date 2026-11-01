import type { PrismaClient } from '../../db/prisma.ts';

export function createPasswordResetRepository(prisma: PrismaClient) {
  return {
    /** Invalidates earlier unused tokens of the user and stores the new one. */
    replace: (
      data: { userId: string; tokenHash: string; expiresAt: Date; ip: string | null },
      at: Date,
    ) =>
      prisma.$transaction(async (tx) => {
        await tx.passwordReset.updateMany({
          where: { userId: data.userId, usedAt: null },
          data: { usedAt: at },
        });
        return tx.passwordReset.create({ data });
      }),

    findUsable: (tokenHash: string, now: Date) =>
      prisma.passwordReset.findFirst({
        where: { tokenHash, usedAt: null, expiresAt: { gt: now } },
        include: { user: true },
      }),

    /**
     * Marks the token used, sets the new password and ends all sessions in one transaction.
     * Returns false if the token was used concurrently.
     */
    complete: (resetId: string, userId: string, passwordHash: string, at: Date) =>
      prisma.$transaction(async (tx) => {
        const claimed = await tx.passwordReset.updateMany({
          where: { id: resetId, usedAt: null },
          data: { usedAt: at },
        });
        if (claimed.count !== 1) return false;
        await tx.user.update({
          where: { id: userId },
          data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
        });
        await tx.refreshToken.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: at },
        });
        return true;
      }),
  };
}

export type PasswordResetRepository = ReturnType<typeof createPasswordResetRepository>;
