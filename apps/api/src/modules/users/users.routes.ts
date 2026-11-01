import { Router, type RequestHandler } from 'express';
import {
  changeRoleRequestSchema,
  createInviteRequestSchema,
  idParamsSchema,
  listUsersQuerySchema,
  UserRole,
} from '@tempo/shared';
import type { RateLimiter } from '../../middleware/rate-limit.ts';
import { requireRole } from '../../middleware/require-role.ts';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import type { createUsersController } from './users.controller.ts';

interface Deps {
  controller: ReturnType<typeof createUsersController>;
  createInvite: RequestHandler;
  authenticate: RequestHandler;
  rateLimit: RateLimiter;
}

/** Everything here is Super Admin only; other roles get 404. */
export function createUsersRouter({
  controller,
  createInvite,
  authenticate,
  rateLimit,
}: Deps): Router {
  const router = Router();
  router.use(authenticate, requireRole(UserRole.SUPER_ADMIN));
  const byId = validateParams(idParamsSchema);

  router.get('/', validateQuery(listUsersQuerySchema), controller.list);

  router.get('/invites', controller.listInvites);
  router.post(
    '/invites',
    rateLimit({
      name: 'invites-create',
      windowMs: 60 * 60_000,
      max: 50,
      key: (req) => req.auth?.userId ?? null,
    }),
    validateBody(createInviteRequestSchema),
    createInvite,
  );
  router.delete('/invites/:id', byId, controller.revokeInvite);

  router.get('/:id', byId, controller.get);
  router.patch('/:id/role', byId, validateBody(changeRoleRequestSchema), controller.changeRole);
  router.post('/:id/deactivate', byId, controller.deactivate);
  router.post('/:id/activate', byId, controller.activate);
  router.post('/:id/revoke-sessions', byId, controller.revokeSessions);
  return router;
}
