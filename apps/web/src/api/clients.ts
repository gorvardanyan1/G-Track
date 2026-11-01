import { clientResponseSchema } from '@tempo/shared';
import { z } from 'zod';
import { http } from './client.ts';

/** Super Admin only. */
export const clientsApi = {
  list: () =>
    http.request('/clients', z.array(clientResponseSchema), {
      query: { includeArchived: 'true' },
    }),
  create: (name: string) =>
    http.request('/clients', clientResponseSchema, { method: 'POST', body: { name } }),
  rename: (id: string, name: string) =>
    http.request(`/clients/${id}`, clientResponseSchema, { method: 'PATCH', body: { name } }),
  setArchived: (id: string, archived: boolean) =>
    http.request(`/clients/${id}/${archived ? 'archive' : 'unarchive'}`, clientResponseSchema, {
      method: 'POST',
    }),
};
