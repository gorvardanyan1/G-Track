import type { PrismaClient } from '../../db/prisma.ts';

export interface NewRefreshToken {
  userId: string;
  familyId: string;
  tokenHash: string;
  expiresAt: Date;
  ip: string | null;
  userAgent: string | null;
}

/** Thrown inside the rotation transaction when another request rotated the token first. */
export class RotationRaceError extends Error {}

export function createRefreshTokenRepository(prisma: PrismaClient) {
  return {
    findByHash: (tokenHash: string) =>
      prisma.refreshToken.findUnique({ where: { tokenHash }, include: { user: true } }),

    create: (data: NewRefreshToken) => prisma.refreshToken.create({ data }),

    /** Creates the successor and retires `currentId` atomically; RotationRaceError if lost. */
    rotate: (currentId: string, next: NewRefreshToken, at: Date) =>
      prisma.$transaction(async (tx) => {
        const created = await tx.refreshToken.create({ data: next });
        const retired = await tx.refreshToken.updateMany({
          where: { id: currentId, revokedAt: null },
          data: { revokedAt: at, replacedById: created.id },
        });
        if (retired.count !== 1) throw new RotationRaceError();
        return created;
      }),

    revokeFamily: (familyId: string, at: Date) =>
      prisma.refreshToken.updateMany({
        where: { familyId, revokedAt: null },
        data: { revokedAt: at },
      }),

    /** Session families of the user that still have a live token. */
    async activeFamilies(userId: string, at: Date): Promise<string[]> {
      const rows = await prisma.refreshToken.findMany({
        where: { userId, revokedAt: null, expiresAt: { gt: at } },
        select: { familyId: true },
        distinct: ['familyId'],
      });
      return rows.map((r) => r.familyId);
    },

    revokeAllForUser: (userId: string, at: Date) =>
      prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: at },
      }),

    findUserForSetup: (userId: string) => prisma.user.findUnique({ where: { id: userId } }),

    /** The user behind a session, if the session still has a live (unrevoked, unexpired) token. */
    async findActiveSessionUser(familyId: string, userId: string, now: Date) {
      const token = await prisma.refreshToken.findFirst({
        where: { familyId, userId, revokedAt: null, expiresAt: { gt: now } },
        select: { user: true },
      });
      return token?.user ?? null;
    },
  };
}

export type RefreshTokenRepository = ReturnType<typeof createRefreshTokenRepository>;
