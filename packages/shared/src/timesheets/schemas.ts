import { z } from 'zod';
import { localDateSchema } from '../common/dates.ts';
import { paginationQuerySchema, queryBoolean } from '../common/pagination.ts';

export const TIMESHEET_STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;
export type TimesheetStatus = (typeof TIMESHEET_STATUSES)[number];

/** Any date inside the week; the api normalizes it to the week start. */
export const timesheetWeekQuerySchema = z.object({ week: localDateSchema });
export const submitTimesheetRequestSchema = z.object({ week: localDateSchema });

const comment = z.string().trim().max(1000);
export const approveTimesheetRequestSchema = z.object({ comment: comment.optional() });
export const rejectTimesheetRequestSchema = z.object({
  comment: comment.min(1, 'say what needs to change'),
});

export const listTimesheetsQuerySchema = paginationQuerySchema.extend({
  status: z.enum(TIMESHEET_STATUSES).optional(),
  userId: z.uuid().optional(),
  /** Inclusive bounds on the week start date. */
  from: localDateSchema.optional(),
  to: localDateSchema.optional(),
  /** Only timesheets the caller may review (never their own). */
  reviewable: queryBoolean.optional(),
});

const person = z.object({ id: z.uuid(), name: z.string() });

export const timesheetSummarySchema = z.object({
  /** Null for a week that has never been submitted (status DRAFT). */
  id: z.uuid().nullable(),
  user: person,
  weekStart: z.iso.date(),
  /** Inclusive last day of the week. */
  weekEnd: z.iso.date(),
  status: z.enum(TIMESHEET_STATUSES),
  submittedAt: z.iso.datetime().nullable(),
  reviewer: person.nullable(),
  reviewedAt: z.iso.datetime().nullable(),
  comment: z.string().nullable(),
  /** Completed entries in the week, split by day in the owner's timezone. */
  totalSeconds: z.number().int(),
});

export const timesheetResponseSchema = timesheetSummarySchema.extend({
  timezone: z.string(),
  /** The 7 dates of the week. */
  dates: z.array(z.iso.date()).length(7),
  /** Grid rows (projects × days); seconds per date, in the order of `dates`. */
  projects: z.array(
    z.object({
      project: z.object({ id: z.uuid(), name: z.string(), color: z.string() }),
      seconds: z.array(z.number().int()).length(7),
      totalSeconds: z.number().int(),
    }),
  ),
  /** Time on projects the viewer can't see (a PM reviewing a worker on several projects). */
  otherSeconds: z.array(z.number().int()).length(7),
  dayTotals: z.array(z.number().int()).length(7),
  /** Whether the viewer may approve/reject it right now. */
  canReview: z.boolean(),
});

export type TimesheetWeekQuery = z.infer<typeof timesheetWeekQuerySchema>;
export type SubmitTimesheetRequest = z.infer<typeof submitTimesheetRequestSchema>;
export type ApproveTimesheetRequest = z.infer<typeof approveTimesheetRequestSchema>;
export type RejectTimesheetRequest = z.infer<typeof rejectTimesheetRequestSchema>;
export type ListTimesheetsQuery = z.infer<typeof listTimesheetsQuerySchema>;
export type TimesheetSummary = z.infer<typeof timesheetSummarySchema>;
export type TimesheetResponse = z.infer<typeof timesheetResponseSchema>;
