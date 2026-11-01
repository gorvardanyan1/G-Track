import type { PendingInviteResponse, UserResponse } from '@tempo/shared';
import type { Invite, User } from '../../generated/prisma/client.ts';

export const toUserResponse = (user: User): UserResponse => ({
  id: user.id,
  email: user.email,
  name: user.name,
  role: user.role,
  timezone: user.timezone,
  isActive: user.isActive,
  twoFactorEnabled: user.totpEnabledAt !== null,
  lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
  createdAt: user.createdAt.toISOString(),
});

export const toPendingInviteResponse = (invite: Invite): PendingInviteResponse => ({
  id: invite.id,
  email: invite.email,
  role: invite.role,
  expiresAt: invite.expiresAt.toISOString(),
  createdAt: invite.createdAt.toISOString(),
});
