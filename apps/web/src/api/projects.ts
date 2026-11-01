import {
  memberCandidateResponseSchema,
  memberResponseSchema,
  projectResponseSchema,
  projectUsageDetailResponseSchema,
  projectUsageListResponseSchema,
  taskResponseSchema,
  type CreateProjectRequest,
  type UpdateProjectRequest,
  type UpdateTaskRequest,
  type UpsertMemberRequest,
} from '@tempo/shared';
import { z } from 'zod';
import { http } from './client.ts';

const base = (id: string) => `/projects/${id}`;

export const projectsApi = {
  list: (includeArchived = false) =>
    http.request('/projects', z.array(projectResponseSchema), {
      query: { includeArchived: includeArchived ? 'true' : undefined },
    }),
  get: (id: string) => http.request(base(id), projectResponseSchema),
  create: (body: CreateProjectRequest) =>
    http.request('/projects', projectResponseSchema, { method: 'POST', body }),
  update: (id: string, body: UpdateProjectRequest) =>
    http.request(base(id), projectResponseSchema, { method: 'PATCH', body }),
  setArchived: (id: string, archived: boolean) =>
    http.request(`${base(id)}/${archived ? 'archive' : 'unarchive'}`, projectResponseSchema, {
      method: 'POST',
    }),

  /** Budget usage of the projects the caller manages. */
  usage: () => http.request('/projects/usage', projectUsageListResponseSchema),
  projectUsage: (id: string) => http.request(`${base(id)}/usage`, projectUsageDetailResponseSchema),

  members: (id: string) => http.request(`${base(id)}/members`, z.array(memberResponseSchema)),
  memberCandidates: (id: string) =>
    http.request(`${base(id)}/member-candidates`, z.array(memberCandidateResponseSchema)),
  upsertMember: (id: string, userId: string, body: UpsertMemberRequest) =>
    http.request(`${base(id)}/members/${userId}`, memberResponseSchema, { method: 'PUT', body }),
  removeMember: (id: string, userId: string) =>
    http.send(`${base(id)}/members/${userId}`, { method: 'DELETE' }),

  tasks: (projectId: string) =>
    http.request(`${base(projectId)}/tasks`, z.array(taskResponseSchema)),
  createTask: (projectId: string, name: string) =>
    http.request(`${base(projectId)}/tasks`, taskResponseSchema, {
      method: 'POST',
      body: { name },
    }),
  updateTask: (projectId: string, taskId: string, body: UpdateTaskRequest) =>
    http.request(`${base(projectId)}/tasks/${taskId}`, taskResponseSchema, {
      method: 'PATCH',
      body,
    }),
  deleteTask: (projectId: string, taskId: string) =>
    http.send(`${base(projectId)}/tasks/${taskId}`, { method: 'DELETE' }),
};
