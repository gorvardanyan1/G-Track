import { addDays, startOfMonthDate, startOfNextMonthDate } from '@tempo/shared';

export type PeriodPreset = 'week' | 'last-week' | 'month' | 'last-month';
export interface DateSpan {
  from: string;
  to: string;
}

export const PERIOD_PRESETS = [
  { value: 'week', label: 'This week' },
  { value: 'last-week', label: 'Last week' },
  { value: 'month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
] as const;

/**
 * The inclusive dates of a preset. Weeks come from `weekOf` (the api knows the organization's
 * week start day); months are calendar months around `today` (the user's local date).
 */
export async function resolvePeriod(
  preset: PeriodPreset,
  today: string,
  weekOf: (date: string) => Promise<DateSpan>,
): Promise<DateSpan> {
  if (preset === 'week') return weekOf(today);
  if (preset === 'last-week') return weekOf(addDays(today, -7));
  const anchor = preset === 'month' ? today : addDays(startOfMonthDate(today), -1);
  return { from: startOfMonthDate(anchor), to: addDays(startOfNextMonthDate(anchor), -1) };
}

/** Days in an inclusive span. */
export const spanDays = ({ from, to }: DateSpan) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
