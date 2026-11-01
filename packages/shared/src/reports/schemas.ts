import { z } from 'zod';
import { dateRangeFields, queryList, withDateRangeLimit } from '../common/dates.ts';
import { pageSchema, paginationQuerySchema, queryBoolean } from '../common/pagination.ts';
import { RoundingMode } from '../time/rounding.ts';

export const MAX_REPORT_RANGE_DAYS = 366;

/**
 * Report filters. Dates are inclusive local dates in the *requesting* user's timezone; id
 * filters may repeat (?projectId=a&projectId=b) or be comma separated.
 */
const reportFilterFields = {
  ...dateRangeFields,
  projectId: queryList(z.uuid()).optional(),
  taskId: queryList(z.uuid()).optional(),
  userId: queryList(z.uuid()).optional(),
  clientId: queryList(z.uuid()).optional(),
  billable: queryBoolean.optional(),
  /** Apply the organization's rounding rule (reports and exports only). */
  round: queryBoolean.default(false),
};

export const reportQuerySchema = withDateRangeLimit(
  z.object(reportFilterFields),
  MAX_REPORT_RANGE_DAYS,
);

/** The report's rows (one per entry per local day), newest first, a page at a time. */
export const reportEntriesQuerySchema = withDateRangeLimit(
  paginationQuerySchema.extend(reportFilterFields),
  MAX_REPORT_RANGE_DAYS,
);

const totals = {
  seconds: z.number().int(),
  billableSeconds: z.number().int(),
  /** Billable amount in cents; null when the viewer may not see rates. */
  amountCents: z.number().int().nullable(),
};

const project = z.object({
  id: z.uuid(),
  name: z.string(),
  color: z.string(),
  clientName: z.string().nullable(),
});

export const reportResponseSchema = z.object({
  from: z.iso.date(),
  to: z.iso.date(),
  timezone: z.string(),
  rounding: z
    .object({
      minutes: z.number().int(),
      mode: z.enum(Object.values(RoundingMode) as [RoundingMode, ...RoundingMode[]]),
    })
    .nullable(),
  totals: z.object({
    ...totals,
    /** Unrounded seconds (equal to `seconds` without rounding). */
    rawSeconds: z.number().int(),
    entryCount: z.number().int(),
  }),
  byDay: z.array(z.object({ date: z.iso.date(), ...totals })),
  byProject: z.array(z.object({ project, ...totals })),
  byTask: z.array(
    z.object({ project, task: z.object({ id: z.uuid(), name: z.string() }).nullable(), ...totals }),
  ),
  byUser: z.array(z.object({ user: z.object({ id: z.uuid(), name: z.string() }), ...totals })),
});

export const reportEntryRowSchema = z.object({
  /** Unique per row: an entry crossing midnight has one row per day. */
  key: z.string(),
  entryId: z.uuid(),
  date: z.iso.date(),
  /** The row's own start/end (clipped to its day and to the report range). */
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  user: z.object({ id: z.uuid(), name: z.string() }),
  project,
  task: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  description: z.string(),
  isBillable: z.boolean(),
  ...totals,
  rawSeconds: z.number().int(),
});
export const reportEntriesResponseSchema = pageSchema(reportEntryRowSchema);

/** What the report filters can offer the caller: exactly the scope the api reports on. */
export const reportOptionsResponseSchema = z.object({
  projects: z.array(
    z.object({
      id: z.uuid(),
      name: z.string(),
      color: z.string(),
      clientId: z.uuid().nullable(),
      archived: z.boolean(),
    }),
  ),
  tasks: z.array(z.object({ id: z.uuid(), projectId: z.uuid(), name: z.string() })),
  users: z.array(z.object({ id: z.uuid(), name: z.string() })),
  clients: z.array(z.object({ id: z.uuid(), name: z.string() })),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;
export type ReportEntriesQuery = z.infer<typeof reportEntriesQuerySchema>;
export type ReportEntryRow = z.infer<typeof reportEntryRowSchema>;
export type ReportEntriesResponse = z.infer<typeof reportEntriesResponseSchema>;
export type ReportOptionsResponse = z.infer<typeof reportOptionsResponseSchema>;
export type ReportResponse = z.infer<typeof reportResponseSchema>;
