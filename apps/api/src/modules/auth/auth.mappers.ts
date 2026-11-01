import type { AuthUser } from '@tempo/shared';
import type { User } from '../../generated/prisma/client.ts';

export function toAuthUser(user: User): AuthUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    timezone: user.timezone,
    twoFactorEnabled: user.totpEnabledAt !== null,
  };
}
