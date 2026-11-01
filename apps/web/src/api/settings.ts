import { orgSettingsResponseSchema, type UpdateOrgSettingsRequest } from '@tempo/shared';
import { http } from './client.ts';

/** Super Admin only. */
export const settingsApi = {
  get: () => http.request('/settings', orgSettingsResponseSchema),
  update: (body: UpdateOrgSettingsRequest) =>
    http.request('/settings', orgSettingsResponseSchema, { method: 'PATCH', body }),
};
