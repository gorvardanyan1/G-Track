import { z } from 'zod';

const week = z.object({ from: z.iso.date(), to: z.iso.date() });
const usage = {
  /** All time on the project; a running timer counts up to the server's "now". */
  totalSeconds: z.number().int(),
  /** The part of it inside the current week (viewer's timezone, organization's week start). */
  weekSeconds: z.number().int(),
};

export const projectUsageSchema = z.object({
  project: z.object({
    id: z.uuid(),
    name: z.string(),
    color: z.string(),
    clientName: z.string().nullable(),
  }),
  budgetHours: z.number().nullable(),
  ...usage,
});

/** GET /projects/usage — projects the caller manages (Super Admin: all active projects). */
export const projectUsageListResponseSchema = z.object({
  week,
  timezone: z.string(),
  items: z.array(projectUsageSchema),
});

/** GET /projects/:id/usage — one project, with each person's share. */
export const projectUsageDetailResponseSchema = projectUsageSchema.extend({
  week,
  timezone: z.string(),
  byMember: z.array(z.object({ user: z.object({ id: z.uuid(), name: z.string() }), ...usage })),
});

export type ProjectUsage = z.infer<typeof projectUsageSchema>;
export type ProjectUsageListResponse = z.infer<typeof projectUsageListResponseSchema>;
export type ProjectUsageDetailResponse = z.infer<typeof projectUsageDetailResponseSchema>;
