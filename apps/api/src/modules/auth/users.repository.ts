import type { PrismaClient } from '../../db/prisma.ts';
import type { User } from '../../generated/prisma/client.ts';

/** User queries the auth flows need. No permission logic here. */
export function createAuthUserRepository(prisma: PrismaClient) {
  return {
    findById: (id: string) => prisma.user.findUnique({ where: { id } }),
    findByEmail: (email: string) => prisma.user.findUnique({ where: { email } }),

    async incrementFailedLogins(id: string): Promise<number> {
      const user = await prisma.user.update({
        where: { id },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      return user.failedLoginCount;
    },

    lockUntil: (id: string, lockedUntil: Date) =>
      prisma.user.update({ where: { id }, data: { lockedUntil } }),

    recordSuccessfulLogin: (id: string, at: Date) =>
      prisma.user.update({
        where: { id },
        data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: at },
      }),

    create: (data: Pick<User, 'email' | 'name' | 'role' | 'timezone' | 'passwordHash'>) =>
      prisma.user.create({ data }),

    updateProfile: (id: string, data: { name?: string; timezone?: string }) =>
      prisma.user.update({ where: { id }, data }),

    /** New password; also clears any lockout. */
    setPassword: (id: string, passwordHash: string) =>
      prisma.user.update({
        where: { id },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      }),

    setPendingTotpSecret: (id: string, totpSecretEncrypted: string) =>
      prisma.user.update({
        where: { id },
        data: { totpSecretEncrypted, totpEnabledAt: null, totpLastUsedStep: null },
      }),

    enableTotp: (id: string, at: Date, step: number) =>
      prisma.user.update({ where: { id }, data: { totpEnabledAt: at, totpLastUsedStep: step } }),

    clearTotp: (id: string) =>
      prisma.user.update({
        where: { id },
        data: { totpSecretEncrypted: null, totpEnabledAt: null, totpLastUsedStep: null },
      }),

    /** Atomically records a used TOTP step; false if this or a later step was already used. */
    async claimTotpStep(id: string, step: number): Promise<boolean> {
      const result = await prisma.user.updateMany({
        where: { id, OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }] },
        data: { totpLastUsedStep: step },
      });
      return result.count === 1;
    },
  };
}

export type AuthUserRepository = ReturnType<typeof createAuthUserRepository>;
