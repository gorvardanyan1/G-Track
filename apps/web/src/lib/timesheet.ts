import type { TimesheetResponse } from '@tempo/shared';

export type SubmitState = 'ready' | 'not-over' | 'locked';

/**
 * Whether a week can be submitted: only once it's over (submitting locks the whole week, so
 * doing it early would freeze the rest of it), and only from draft or after being returned.
 */
export function submitState(
  sheet: Pick<TimesheetResponse, 'status' | 'weekEnd'>,
  today: string,
): SubmitState {
  if (sheet.status === 'SUBMITTED' || sheet.status === 'APPROVED') return 'locked';
  return sheet.weekEnd < today ? 'ready' : 'not-over';
}
