import { formatDecimalHours, formatDuration, toLocalDateTime } from '@tempo/shared';
import { toCsv } from '../../lib/csv.ts';
import type { Report } from './reports.service.ts';

const money = (cents: number) => (cents / 100).toFixed(2);

/**
 * One row per entry per local day (an entry crossing midnight becomes two rows), so the rows
 * add up exactly to the report totals. Times are in the requesting user's timezone.
 */
export function reportCsv(report: Report): string {
  const rounded = report.rounding !== null;
  const header = [
    'Date',
    'Start',
    'End',
    'User',
    'Client',
    'Project',
    'Task',
    'Description',
    'Billable',
    'Duration',
    'Duration (h)',
    ...(rounded ? ['Actual duration'] : []),
    ...(report.showAmounts ? ['Amount'] : []),
    'Entry ID',
  ];
  const rows = report.portions.map((p) => {
    const start = toLocalDateTime(p.start, report.timezone);
    const end = toLocalDateTime(p.end, report.timezone);
    return [
      p.date,
      start.time,
      // A portion that runs to midnight ends at 24:00 of its own day.
      end.date === p.date ? end.time : '24:00:00',
      p.entry.user.name,
      p.entry.project.client?.name ?? '',
      p.entry.project.name,
      p.entry.task?.name ?? '',
      p.entry.description,
      p.entry.isBillable ? 'Yes' : 'No',
      formatDuration(p.seconds),
      formatDecimalHours(p.seconds),
      ...(rounded ? [formatDuration(p.rawSeconds)] : []),
      ...(report.showAmounts ? [money(p.amountCents)] : []),
      p.entry.id,
    ];
  });
  const { totals } = report.summary;
  const totalRow = [
    'Total',
    ...Array<string>(8).fill(''),
    formatDuration(totals.seconds),
    formatDecimalHours(totals.seconds),
    ...(rounded ? [formatDuration(totals.rawSeconds)] : []),
    ...(report.showAmounts ? [money(totals.amountCents)] : []),
    '',
  ];
  return toCsv([header, ...rows, totalRow]);
}
