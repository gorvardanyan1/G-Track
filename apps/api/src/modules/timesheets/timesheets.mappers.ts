import { addDays, type TimesheetResponse, type TimesheetSummary } from '@tempo/shared';
import type { TimesheetDetail } from './timesheets.service.ts';
import { fromDbDate, type TimesheetWithPeople } from './timesheets.repository.ts';

/** A week without a row is a DRAFT nobody has submitted yet. */
function summary(
  user: { id: string; name: string },
  weekStart: string,
  sheet: TimesheetWithPeople | null,
  totalSeconds: number,
): TimesheetSummary {
  return {
    id: sheet?.id ?? null,
    user: { id: user.id, name: user.name },
    weekStart,
    weekEnd: addDays(weekStart, 6),
    status: sheet?.status ?? 'DRAFT',
    submittedAt: sheet?.submittedAt?.toISOString() ?? null,
    reviewer: sheet?.reviewer ?? null,
    reviewedAt: sheet?.reviewedAt?.toISOString() ?? null,
    comment: sheet?.comment ?? null,
    totalSeconds,
  };
}

export const toTimesheetSummary = (sheet: TimesheetWithPeople, totalSeconds: number) =>
  summary(sheet.user, fromDbDate(sheet.weekStart), sheet, totalSeconds);

export function toTimesheetResponse(d: TimesheetDetail): TimesheetResponse {
  return {
    ...summary(d.user, d.week.weekStart, d.sheet, d.grid.totalSeconds),
    timezone: d.week.zone,
    dates: d.week.dates,
    projects: d.grid.projects,
    otherSeconds: d.grid.otherSeconds,
    dayTotals: d.grid.dayTotals,
    canReview: d.canReview,
  };
}
