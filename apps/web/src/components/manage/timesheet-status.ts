import type { TimesheetStatus } from '@tempo/shared';

export const TIMESHEET_STATUS: Record<
  TimesheetStatus,
  { label: string; tone: 'neutral' | 'accent' | 'success' | 'warning' }
> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Waiting for review', tone: 'accent' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Returned', tone: 'warning' },
};
