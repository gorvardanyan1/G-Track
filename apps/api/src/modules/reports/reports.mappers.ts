import type { ReportEntriesQuery, ReportEntriesResponse, ReportResponse } from '@tempo/shared';
import type { Report, ReportEntry } from './reports.service.ts';

type Project = ReportResponse['byProject'][number]['project'];

/** Names for the ids in a report's breakdowns (every id there comes from some entry). */
export function reportNames(report: Report) {
  const projects = new Map<string, Project>();
  const tasks = new Map<string, { id: string; name: string }>();
  const users = new Map<string, { id: string; name: string }>();
  for (const { entry } of report.portions) {
    projects.set(entry.projectId, projectOf(entry));
    if (entry.task) tasks.set(entry.task.id, entry.task);
    users.set(entry.user.id, entry.user);
  }
  const missing = { id: '', name: '' };
  return {
    project: (id: string) => projects.get(id) ?? { ...missing, color: '', clientName: null },
    task: (id: string | null) => (id ? (tasks.get(id) ?? missing) : null),
    user: (id: string) => users.get(id) ?? missing,
  };
}

export const projectOf = (entry: ReportEntry): Project => ({
  id: entry.project.id,
  name: entry.project.name,
  color: entry.project.color,
  clientName: entry.project.client?.name ?? null,
});

export function toReportResponse(report: Report): ReportResponse {
  const names = reportNames(report);
  const amount = (cents: number) => (report.showAmounts ? cents : null);
  const totals = <T extends { seconds: number; billableSeconds: number; amountCents: number }>(
    row: T,
  ) => ({
    seconds: row.seconds,
    billableSeconds: row.billableSeconds,
    amountCents: amount(row.amountCents),
  });
  const { summary } = report;
  return {
    from: report.from,
    to: report.to,
    timezone: report.timezone,
    rounding: report.rounding,
    totals: {
      ...totals(summary.totals),
      rawSeconds: summary.totals.rawSeconds,
      entryCount: summary.totals.entryCount,
    },
    byDay: summary.byDay.map((d) => ({ date: d.date, ...totals(d) })),
    byProject: summary.byProject.map((p) => ({
      project: names.project(p.projectId),
      ...totals(p),
    })),
    byTask: summary.byTask.map((t) => ({
      project: names.project(t.projectId),
      task: names.task(t.taskId),
      ...totals(t),
    })),
    byUser: summary.byUser.map((u) => ({ user: names.user(u.userId), ...totals(u) })),
  };
}

/** One page of the report's rows (an entry per local day), newest first. */
export function toReportEntriesResponse(
  report: Report,
  { page, pageSize }: Pick<ReportEntriesQuery, 'page' | 'pageSize'>,
): ReportEntriesResponse {
  const rows = report.portions.toReversed();
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize).map((p) => ({
      key: `${p.entry.id}:${p.date}`,
      entryId: p.entry.id,
      date: p.date,
      start: p.start.toISOString(),
      end: p.end.toISOString(),
      user: p.entry.user,
      project: projectOf(p.entry),
      task: p.entry.task,
      description: p.entry.description,
      isBillable: p.entry.isBillable,
      seconds: p.seconds,
      rawSeconds: p.rawSeconds,
      billableSeconds: p.billableSeconds,
      amountCents: report.showAmounts ? p.amountCents : null,
    })),
    total: rows.length,
    page,
    pageSize,
  };
}
