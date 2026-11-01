import { z } from 'zod';
import { PROJECT_ROLES } from '../auth/permissions.ts';
import { USER_ROLES } from '../auth/roles.ts';
import { queryBoolean, twoDecimals } from '../common/pagination.ts';

const name = z.string().trim().min(1).max(120);
const color = z.string().regex(/^#[0-9A-Fa-f]{6}$/, 'must be a hex color like #5B5BF7');
const budgetHours = twoDecimals.positive().nullable();
const hourlyRate = twoDecimals.nonnegative().nullable();

// ─── clients ───────────────────────────────────────────────────────────────────

export const listClientsQuerySchema = z.object({ includeArchived: queryBoolean.default(false) });
export const createClientRequestSchema = z.object({ name });
export const updateClientRequestSchema = z.object({ name });

export const clientResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  archivedAt: z.iso.datetime().nullable(),
});

// ─── projects ──────────────────────────────────────────────────────────────────

export const listProjectsQuerySchema = z.object({ includeArchived: queryBoolean.default(false) });

export const createProjectRequestSchema = z.object({
  clientId: z.uuid().nullable().default(null),
  name,
  color,
  budgetHours: budgetHours.default(null),
  isBillable: z.boolean().default(true),
});

export const updateProjectRequestSchema = z
  .object({ clientId: z.uuid().nullable(), name, color, budgetHours, isBillable: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'nothing to update');

export const projectResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
  isBillable: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  client: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** The caller's relation to the project; drives what the UI offers. */
  access: z.enum(['admin', 'manager', 'member']),
  /** Only for admins and the project's PM. */
  budgetHours: z.number().nullable().optional(),
});

// ─── members ───────────────────────────────────────────────────────────────────

export const memberParamsSchema = z.object({ id: z.uuid(), userId: z.uuid() });

export const upsertMemberRequestSchema = z.object({
  roleInProject: z.enum(PROJECT_ROLES),
  hourlyRate: hourlyRate.default(null),
});

export const memberResponseSchema = z.object({
  userId: z.uuid(),
  name: z.string(),
  email: z.email(),
  role: z.enum(USER_ROLES),
  roleInProject: z.enum(PROJECT_ROLES),
  hourlyRate: z.number().nullable(),
});

export const memberCandidateResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  email: z.email(),
  role: z.enum(USER_ROLES),
});

// ─── tasks ─────────────────────────────────────────────────────────────────────

export const taskParamsSchema = z.object({ id: z.uuid(), taskId: z.uuid() });
export const createTaskRequestSchema = z.object({ name });
export const updateTaskRequestSchema = z
  .object({ name, isDone: z.boolean() })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'nothing to update');

export const taskResponseSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  isDone: z.boolean(),
});

export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
export type CreateClientRequest = z.infer<typeof createClientRequestSchema>;
export type UpdateClientRequest = z.infer<typeof updateClientRequestSchema>;
export type ClientResponse = z.infer<typeof clientResponseSchema>;
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;
export type ProjectResponse = z.infer<typeof projectResponseSchema>;
export type MemberParams = z.infer<typeof memberParamsSchema>;
export type UpsertMemberRequest = z.infer<typeof upsertMemberRequestSchema>;
export type MemberResponse = z.infer<typeof memberResponseSchema>;
export type MemberCandidateResponse = z.infer<typeof memberCandidateResponseSchema>;
export type TaskParams = z.infer<typeof taskParamsSchema>;
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof updateTaskRequestSchema>;
export type TaskResponse = z.infer<typeof taskResponseSchema>;
