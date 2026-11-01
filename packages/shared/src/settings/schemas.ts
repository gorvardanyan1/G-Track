import { z } from 'zod';
import { timezoneSchema } from '../auth/schemas.ts';
import { RoundingMode } from '../time/rounding.ts';

const roundingModes = Object.values(RoundingMode) as [RoundingMode, ...RoundingMode[]];

/** Bounds mirror the database CHECK constraints on org_settings. */
export const updateOrgSettingsRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    defaultTimezone: timezoneSchema,
    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    weekStartDay: z.number().int().min(1).max(7),
    /** 0 disables rounding. Applied in reports/exports only. */
    roundingMinutes: z.number().int().min(0).max(60),
    roundingMode: z.enum(roundingModes),
    maxTimerDurationSeconds: z.number().int().min(60).max(86_400),
    timesheetApprovalEnabled: z.boolean(),
    /** Entries older than this many days are locked; null disables locking. */
    lockAfterDays: z.number().int().min(1).max(3650).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'nothing to update');

export const orgSettingsResponseSchema = z.object({
  name: z.string(),
  defaultTimezone: z.string(),
  weekStartDay: z.number().int(),
  roundingMinutes: z.number().int(),
  roundingMode: z.enum(roundingModes),
  maxTimerDurationSeconds: z.number().int(),
  timesheetApprovalEnabled: z.boolean(),
  lockAfterDays: z.number().int().nullable(),
  /** Null until a Super Admin saves the settings for the first time (defaults apply). */
  updatedAt: z.iso.datetime().nullable(),
  updatedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
});

export type UpdateOrgSettingsRequest = z.infer<typeof updateOrgSettingsRequestSchema>;
export type OrgSettingsResponse = z.infer<typeof orgSettingsResponseSchema>;
