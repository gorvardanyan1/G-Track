import { Router, type RequestHandler } from 'express';
import {
  createProjectRequestSchema,
  createTaskRequestSchema,
  idParamsSchema,
  listProjectsQuerySchema,
  memberParamsSchema,
  taskParamsSchema,
  updateProjectRequestSchema,
  updateTaskRequestSchema,
  upsertMemberRequestSchema,
  UserRole,
} from '@tempo/shared';
import { requireRole } from '../../middleware/require-role.ts';
import { validateBody, validateParams, validateQuery } from '../../middleware/validate.ts';
import type { createProjectsController } from './projects.controller.ts';

/**
 * Route-level checks only gate admin-only actions; per-project visibility (404) and
 * per-action permissions (403) are decided in the services.
 */
export function createProjectsRouter(
  controller: ReturnType<typeof createProjectsController>,
  authenticate: RequestHandler,
): Router {
  const router = Router();
  router.use(authenticate);
  const adminOnly = requireRole(UserRole.SUPER_ADMIN);
  const byId = validateParams(idParamsSchema);
  const byMember = validateParams(memberParamsSchema);
  const byTask = validateParams(taskParamsSchema);

  router.get('/', validateQuery(listProjectsQuerySchema), controller.list);
  router.post('/', adminOnly, validateBody(createProjectRequestSchema), controller.create);
  router.get('/usage', controller.usage);
  router.get('/:id', byId, controller.get);
  router.get('/:id/usage', byId, controller.projectUsage);
  router.patch('/:id', byId, validateBody(updateProjectRequestSchema), controller.update);
  router.post('/:id/archive', adminOnly, byId, controller.archive);
  router.post('/:id/unarchive', adminOnly, byId, controller.unarchive);

  router.get('/:id/members', byId, controller.listMembers);
  router.get('/:id/member-candidates', byId, controller.memberCandidates);
  router.put(
    '/:id/members/:userId',
    byMember,
    validateBody(upsertMemberRequestSchema),
    controller.upsertMember,
  );
  router.delete('/:id/members/:userId', byMember, controller.removeMember);

  router.get('/:id/tasks', byId, controller.listTasks);
  router.post('/:id/tasks', byId, validateBody(createTaskRequestSchema), controller.createTask);
  router.patch(
    '/:id/tasks/:taskId',
    byTask,
    validateBody(updateTaskRequestSchema),
    controller.updateTask,
  );
  router.delete('/:id/tasks/:taskId', byTask, controller.deleteTask);
  return router;
}
