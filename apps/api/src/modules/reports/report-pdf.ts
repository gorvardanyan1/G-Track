import { formatDuration, toLocalDateTime } from '@tempo/shared';
import { createPdfDocument } from '../../lib/pdf/pdf-document.ts';
import { createFlowLayout, type Column } from '../../lib/pdf/pdf-layout.ts';
import { reportNames } from './reports.mappers.ts';
import type { Report } from './reports.service.ts';

const A4_LANDSCAPE = { width: 842, height: 595 };
/** Beyond this the detail table is cut off; the CSV export always has every row. */
export const PDF_DETAIL_ROW_LIMIT = 2000;

const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Summary tables plus the detailed entries, in the requesting user's timezone. */
export function reportPdf(report: Report): Buffer {
  const doc = createPdfDocument(A4_LANDSCAPE);
  const title = `Time report ${report.from} – ${report.to}`;
  const layout = createFlowLayout(doc, {
    margin: 36,
    footer: (page) => `${report.orgName} · ${title} · Page ${page}`,
  });
  const names = reportNames(report);
  const { summary, showAmounts } = report;
  const amountColumn: Column[] = showAmounts
    ? [{ title: 'Amount', width: 0.12, align: 'right' }]
    : [];
  const amountCell = (cents: number) => (showAmounts ? [money(cents)] : []);
  const generated = toLocalDateTime(report.generatedAt, report.timezone);

  layout.heading(report.orgName, 9);
  layout.heading('Time report', 20);
  layout.text(
    [
      `${report.from} – ${report.to}`,
      `Times in ${report.timezone}`,
      report.rounding
        ? `Rounded per entry to ${report.rounding.minutes} min (${report.rounding.mode.toLowerCase()})`
        : 'Not rounded',
      `Generated ${generated.date} ${generated.time.slice(0, 5)}`,
    ].join('  ·  '),
  );
  layout.space(10);
  layout.figures([
    { label: 'Total', value: formatDuration(summary.totals.seconds) },
    { label: 'Billable', value: formatDuration(summary.totals.billableSeconds) },
    ...(showAmounts ? [{ label: 'Amount', value: money(summary.totals.amountCents) }] : []),
    { label: 'Entries', value: String(summary.totals.entryCount) },
  ]);
  layout.space(8);

  const hours: Column[] = [
    { title: 'Duration', width: 0.12, align: 'right' },
    { title: 'Billable', width: 0.12, align: 'right' },
    ...amountColumn,
  ];
  const figures = (t: { seconds: number; billableSeconds: number; amountCents: number }) => [
    formatDuration(t.seconds),
    formatDuration(t.billableSeconds),
    ...amountCell(t.amountCents),
  ];
  const totalRow = (labels: number) => [
    'Total',
    ...Array<string>(labels - 1).fill(''),
    ...figures(summary.totals),
  ];

  layout.heading('By project');
  layout.table(
    [{ title: 'Project', width: 0.34 }, { title: 'Client', width: 0.22 }, ...hours],
    summary.byProject.map((p) => {
      const project = names.project(p.projectId);
      return [project.name, project.clientName ?? '—', ...figures(p)];
    }),
    { totalRow: totalRow(2) },
  );

  layout.heading('By worker');
  layout.table(
    [{ title: 'Worker', width: 0.56 }, ...hours],
    summary.byUser.map((u) => [names.user(u.userId).name, ...figures(u)]),
    { totalRow: totalRow(1) },
  );

  layout.heading('By task');
  layout.table(
    [{ title: 'Project', width: 0.28 }, { title: 'Task', width: 0.28 }, ...hours],
    summary.byTask.map((t) => [
      names.project(t.projectId).name,
      names.task(t.taskId)?.name ?? 'No task',
      ...figures(t),
    ]),
    { totalRow: totalRow(2) },
  );

  layout.heading('By day');
  layout.table(
    [{ title: 'Date', width: 0.56 }, ...hours],
    summary.byDay.filter((d) => d.seconds > 0).map((d) => [d.date, ...figures(d)]),
    { totalRow: totalRow(1) },
  );

  layout.heading('Entries');
  if (report.portions.length > PDF_DETAIL_ROW_LIMIT) {
    layout.text(
      `Showing the first ${PDF_DETAIL_ROW_LIMIT} of ${report.portions.length} rows; the CSV export has all of them.`,
    );
  }
  layout.table(
    [
      { title: 'Date', width: 0.08 },
      { title: 'Time', width: 0.09 },
      { title: 'Worker', width: 0.12 },
      { title: 'Project', width: 0.13 },
      { title: 'Task', width: 0.11 },
      { title: 'Description', width: showAmounts ? 0.21 : 0.29 },
      { title: 'Billable', width: 0.06 },
      { title: 'Duration', width: 0.08, align: 'right' },
      ...(showAmounts ? [{ title: 'Amount', width: 0.08, align: 'right' as const }] : []),
    ],
    report.portions.slice(0, PDF_DETAIL_ROW_LIMIT).map((p) => {
      const start = toLocalDateTime(p.start, report.timezone).time.slice(0, 5);
      const end = toLocalDateTime(p.end, report.timezone);
      return [
        p.date,
        `${start}–${end.date === p.date ? end.time.slice(0, 5) : '24:00'}`,
        p.entry.user.name,
        p.entry.project.name,
        p.entry.task?.name ?? '',
        p.entry.description,
        p.entry.isBillable ? 'Yes' : 'No',
        formatDuration(p.seconds),
        ...amountCell(p.amountCents),
      ];
    }),
  );

  return doc.toBuffer({ title, createdAt: report.generatedAt });
}
