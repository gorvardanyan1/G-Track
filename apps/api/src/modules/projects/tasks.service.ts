import { projectPermissions, type UpdateTaskRequest } from '@tempo/shared';
import { ConflictError, NotFoundError } from '../../errors/app-error.ts';
import { isForeignKeyViolation, isUniqueViolation } from '../../lib/prisma-errors.ts';
import type { RequestContext } from '../../lib/request-context.ts';
import { AuditAction } from '../audit/audit-actions.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { AuthContext } from '../auth/auth.types.ts';
import { assertAllowed, assertNotArchived, loadVisibleProject } from './project-access.ts';
import type { ProjectsRepository } from './projects.repository.ts';

interface Deps {
  projects: ProjectsRepository;
  audit: AuditService;
}

const duplicateName = () => new ConflictError('This project already has a task with this name');

export function createTasksService({ projects, audit }: Deps) {
  async function loadForManagement(auth: AuthContext, projectId: string) {
    const { project, access } = await loadVisibleProject(projects, auth, projectId);
    assertAllowed(
      projectPermissions.manageTasks(access),
      'You cannot manage tasks of this project',
    );
    assertNotArchived(project);
  }

  async function loadTask(projectId: string, taskId: string) {
    const task = await projects.findTask(projectId, taskId);
    if (!task) throw new NotFoundError('Task not found');
    return task;
  }

  const record = (
    action: AuditAction,
    auth: AuthContext,
    taskId: string,
    context: RequestContext,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ) =>
    audit.record(
      action,
      {
        actorId: auth.userId,
        targetType: 'task',
        targetId: taskId,
        ...(before && { before }),
        ...(after && { after }),
      },
      context,
    );

  return {
    async list(auth: AuthContext, projectId: string) {
      await loadVisibleProject(projects, auth, projectId);
      return projects.listTasks(projectId);
    },

    async create(auth: AuthContext, projectId: string, name: string, context: RequestContext) {
      await loadForManagement(auth, projectId);
      try {
        const task = await projects.createTask(projectId, name);
        await record(AuditAction.TASK_CREATED, auth, task.id, context, undefined, {
          projectId,
          name,
        });
        return task;
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicateName();
        throw err;
      }
    },

    async update(
      auth: AuthContext,
      projectId: string,
      taskId: string,
      input: UpdateTaskRequest,
      context: RequestContext,
    ) {
      await loadForManagement(auth, projectId);
      const task = await loadTask(projectId, taskId);
      try {
        const updated = await projects.updateTask(taskId, input);
        await record(
          AuditAction.TASK_UPDATED,
          auth,
          taskId,
          context,
          { name: task.name, isDone: task.isDone },
          { name: updated.name, isDone: updated.isDone },
        );
        return updated;
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicateName();
        throw err;
      }
    },

    async remove(auth: AuthContext, projectId: string, taskId: string, context: RequestContext) {
      await loadForManagement(auth, projectId);
      const task = await loadTask(projectId, taskId);
      try {
        await projects.deleteTask(taskId);
      } catch (err) {
        if (isForeignKeyViolation(err)) {
          throw new ConflictError('This task has time entries; mark it as done instead');
        }
        throw err;
      }
      await record(AuditAction.TASK_DELETED, auth, taskId, context, { projectId, name: task.name });
    },
  };
}

export type TasksService = ReturnType<typeof createTasksService>;
