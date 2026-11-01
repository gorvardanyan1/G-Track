import { z } from 'zod';
import {
  dateRangeFields,
  localDateSchema as localDate,
  withDateRangeLimit,
} from '../common/dates.ts';
const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'must be a time like 09:30');

/** A wall-clock moment in the user's profile timezone. */
export const localDateTimeSchema = z.object({
  date: localDate,
  time: localTime,
  /** Needed only when clocks go back and the time happens twice. */
  ambiguity: z.enum(['earlier', 'later']).optional(),
});

const description = z.string().trim().max(500);

export const startTimerRequestSchema = z.object({
  projectId: z.uuid(),
  taskId: z.uuid().nullable().default(null),
  description: description.default(''),
  /** Defaults to the project's billable setting. */
  isBillable: z.boolean().optional(),
});

export const createTimeEntryRequestSchema = z.object({
  projectId: z.uuid(),
  taskId: z.uuid().nullable().default(null),
  description: description.default(''),
  isBillable: z.boolean().optional(),
  start: localDateTimeSchema,
  end: localDateTimeSchema,
});

export const updateTimeEntryRequestSchema = z
  .object({
    projectId: z.uuid(),
    taskId: z.uuid().nullable(),
    description,
    isBillable: z.boolean(),
    start: localDateTimeSchema,
    end: localDateTimeSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, 'nothing to update');

export const duplicateTimeEntryRequestSchema = z.object({
  /** Local date to copy the entry to (same local times). Defaults to today. */
  date: localDate.optional(),
});

export const MAX_LIST_RANGE_DAYS = 62;

export const listTimeEntriesQuerySchema = withDateRangeLimit(
  /** Inclusive local dates in the viewer's timezone. */
  z.object({ ...dateRangeFields, userId: z.uuid().optional() }),
  MAX_LIST_RANGE_DAYS,
);

export const timeEntryResponseSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  projectId: z.uuid(),
  taskId: z.uuid().nullable(),
  description: z.string(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime().nullable(),
  durationSeconds: z.number().int().nullable(),
  isBillable: z.boolean(),
  source: z.enum(['TIMER', 'MANUAL', 'AUTO_STOPPED']),
  project: z.object({ id: z.uuid(), name: z.string(), color: z.string() }),
  task: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** False when the caller isn't the owner or the period is locked/approved. */
  editable: z.boolean(),
});

export const timerResponseSchema = z.object({
  entry: timeEntryResponseSchema.nullable(),
  serverTime: z.iso.datetime(),
});

export type LocalDateTime = z.infer<typeof localDateTimeSchema>;
export type StartTimerRequest = z.infer<typeof startTimerRequestSchema>;
export type CreateTimeEntryRequest = z.infer<typeof createTimeEntryRequestSchema>;
export type UpdateTimeEntryRequest = z.infer<typeof updateTimeEntryRequestSchema>;
export type DuplicateTimeEntryRequest = z.infer<typeof duplicateTimeEntryRequestSchema>;
export type ListTimeEntriesQuery = z.infer<typeof listTimeEntriesQuerySchema>;
export type TimeEntryResponse = z.infer<typeof timeEntryResponseSchema>;
export type TimerResponse = z.infer<typeof timerResponseSchema>;
