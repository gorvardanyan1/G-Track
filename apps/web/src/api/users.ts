import {
  inviteResponseSchema,
  pageSchema,
  pendingInviteResponseSchema,
  userResponseSchema,
  type UserRole,
} from '@tempo/shared';
import { z } from 'zod';
import { http } from './client.ts';

export interface UserListParams {
  search?: string;
  role?: UserRole;
  status?: 'active' | 'inactive' | 'all';
  page?: number;
  pageSize?: number;
}

/** Super Admin only. */
export const usersApi = {
  list: (p: UserListParams = {}) =>
    http.request('/users', pageSchema(userResponseSchema), {
      query: {
        search: p.search || undefined,
        role: p.role,
        status: p.status,
        page: p.page ? String(p.page) : undefined,
        pageSize: p.pageSize ? String(p.pageSize) : undefined,
      },
    }),
  changeRole: (id: string, role: UserRole) =>
    http.request(`/users/${id}/role`, userResponseSchema, { method: 'PATCH', body: { role } }),
  setActive: (id: string, active: boolean) =>
    http.request(`/users/${id}/${active ? 'activate' : 'deactivate'}`, userResponseSchema, {
      method: 'POST',
    }),
  revokeSessions: (id: string) => http.send(`/users/${id}/revoke-sessions`, { method: 'POST' }),

  invites: () => http.request('/users/invites', z.array(pendingInviteResponseSchema)),
  invite: (email: string, role: UserRole) =>
    http.request('/users/invites', inviteResponseSchema, {
      method: 'POST',
      body: { email, role },
    }),
  revokeInvite: (id: string) => http.send(`/users/invites/${id}`, { method: 'DELETE' }),
};
