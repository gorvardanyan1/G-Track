import type { RequestHandler } from 'express';
import type { OrgSettingsResponse, UpdateOrgSettingsRequest } from '@tempo/shared';
import { requestContext } from '../../lib/request-context.ts';
import { validatedBody } from '../../middleware/validate.ts';
import { requireAuth } from '../auth/auth.http.ts';
import type { OrgSettings } from './settings.repository.ts';
import type { SettingsService } from './settings.service.ts';

const toResponse = ({ updatedAt, ...settings }: OrgSettings): OrgSettingsResponse => ({
  ...settings,
  updatedAt: updatedAt?.toISOString() ?? null,
});

export function createSettingsController(settings: SettingsService) {
  const get: RequestHandler = async (_req, res) => {
    res.json(toResponse(await settings.get()));
  };

  const update: RequestHandler = async (req, res) => {
    const saved = await settings.update(
      requireAuth(req),
      validatedBody<UpdateOrgSettingsRequest>(req),
      requestContext(req),
    );
    res.json(toResponse(saved));
  };

  return { get, update };
}
