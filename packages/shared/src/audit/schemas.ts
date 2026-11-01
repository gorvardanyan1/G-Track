import { z } from 'zod';
import { localDateSchema, queryList } from '../common/dates.ts';
import { paginationQuerySchema } from '../common/pagination.ts';

export const listAuditLogsQuerySchema = paginationQuerySchema
  .extend({
    actorId: z.uuid().optional(),
    /** Exact action names, or a prefix ending in "." (e.g. "time_entry."). */
    action: queryList(z.string().regex(/^[a-z0-9_.]{1,64}$/), 20).optional(),
    targetType: z
      .string()
      .regex(/^[a-z_]{1,32}$/)
      .optional(),
    targetId: z.string().min(1).max(64).optional(),
    /** Inclusive local dates in the viewer's timezone. */
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: '"to" must not be before "from"',
    path: ['to'],
  });

export const auditLogResponseSchema = z.object({
  id: z.uuid(),
  createdAt: z.iso.datetime(),
  action: z.string(),
  actor: z.object({ id: z.uuid(), name: z.string(), email: z.string() }).nullable(),
  targetType: z.string().nullable(),
  targetId: z.string().nullable(),
  before: z.unknown(),
  after: z.unknown(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
});

export type ListAuditLogsQuery = z.infer<typeof listAuditLogsQuerySchema>;
export type AuditLogResponse = z.infer<typeof auditLogResponseSchema>;
