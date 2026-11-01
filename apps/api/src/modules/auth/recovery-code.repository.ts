import type { PrismaClient } from '../../db/prisma.ts';

export function createRecoveryCodeRepository(prisma: PrismaClient) {
  return {
    replaceAll: (userId: string, codeHashes: readonly string[]) =>
      prisma.$transaction([
        prisma.recoveryCode.deleteMany({ where: { userId } }),
        prisma.recoveryCode.createMany({
          data: codeHashes.map((codeHash) => ({ userId, codeHash })),
        }),
      ]),

    deleteAll: (userId: string) => prisma.recoveryCode.deleteMany({ where: { userId } }),

    /** Marks a matching unused code as used; false if none matched. */
    async consume(userId: string, codeHash: string, at: Date): Promise<boolean> {
      const result = await prisma.recoveryCode.updateMany({
        where: { userId, codeHash, usedAt: null },
        data: { usedAt: at },
      });
      return result.count > 0;
    },

    countUnused: (userId: string) => prisma.recoveryCode.count({ where: { userId, usedAt: null } }),
  };
}

export type RecoveryCodeRepository = ReturnType<typeof createRecoveryCodeRepository>;
