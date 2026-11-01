import type { PrismaClient } from '../../db/prisma.ts';
import type { UserRole } from '../../generated/prisma/client.ts';

export function createInviteRepository(prisma: PrismaClient) {
  return {
    /** Revokes older pending invites for the email and creates a new one, atomically. */
    replacePending: (
      data: {
        email: string;
        role: UserRole;
        tokenHash: string;
        invitedById: string;
        expiresAt: Date;
      },
      at: Date,
    ) =>
      prisma.$transaction(async (tx) => {
        await tx.invite.updateMany({
          where: { email: data.email, acceptedAt: null, revokedAt: null },
          data: { revokedAt: at },
        });
        return tx.invite.create({ data });
      }),

    /** A pending (not accepted, not revoked, not expired) invite. */
    findUsable: (tokenHash: string, now: Date) =>
      prisma.invite.findFirst({
        where: { tokenHash, acceptedAt: null, revokedAt: null, expiresAt: { gt: now } },
      }),

    /**
     * Creates the user and marks the invite accepted in one transaction. Returns null if the
     * invite was used concurrently.
     */
    accept: (
      inviteId: string,
      user: { email: string; name: string; role: UserRole; timezone: string; passwordHash: string },
      at: Date,
    ) =>
      prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: user });
        const claimed = await tx.invite.updateMany({
          where: { id: inviteId, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: at, acceptedUserId: created.id },
        });
        if (claimed.count !== 1) throw new InviteAlreadyUsedError();
        return created;
      }),
  };
}

export class InviteAlreadyUsedError extends Error {}

export type InviteRepository = ReturnType<typeof createInviteRepository>;
