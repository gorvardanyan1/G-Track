import { Router, type RequestHandler } from 'express';
import {
  createClientRequestSchema,
  idParamsSchema,
  listClientsQuerySchema,
  updateClientRequestSchema,
  UserRole,
} from '@tempo/shared';
import { requireRole } from '../../middleware/require-role.ts';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import type { createClientsController } from './clients.controller.ts';

/** Super Admin only; PMs and workers see client names through their projects. */
export function createClientsRouter(
  controller: ReturnType<typeof createClientsController>,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.use(authenticate, requireRole(UserRole.SUPER_ADMIN));
  const byId = validateParams(idParamsSchema);

  router.get('/', validateQuery(listClientsQuerySchema), controller.list);
  router.post('/', validateBody(createClientRequestSchema), controller.create);
  router.get('/:id', byId, controller.get);
  router.patch('/:id', byId, validateBody(updateClientRequestSchema), controller.update);
  router.post('/:id/archive', byId, controller.archive);
  router.post('/:id/unarchive', byId, controller.unarchive);
  return router;
}
