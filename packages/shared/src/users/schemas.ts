import { z } from 'zod';
import { USER_ROLES } from '../auth/roles.ts';
import { paginationQuerySchema } from '../common/pagination.ts';

export const listUsersQuerySchema = paginationQuerySchema.extend({
  search: z.string().trim().min(1).max(100).optional(),
  role: z.enum(USER_ROLES).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('all'),
});

export const changeRoleRequestSchema = z.object({ role: z.enum(USER_ROLES) });

export const userResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  role: z.enum(USER_ROLES),
  timezone: z.string(),
  isActive: z.boolean(),
  twoFactorEnabled: z.boolean(),
  lastLoginAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});

export const pendingInviteResponseSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  role: z.enum(USER_ROLES),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type ChangeRoleRequest = z.infer<typeof changeRoleRequestSchema>;
export type UserResponse = z.infer<typeof userResponseSchema>;
export type PendingInviteResponse = z.infer<typeof pendingInviteResponseSchema>;
