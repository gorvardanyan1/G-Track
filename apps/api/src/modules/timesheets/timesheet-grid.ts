import { addDays, reportPortions, startOfLocalDay } from '@tempo/shared';

/** One timesheet week in its owner's timezone. */
export interface WeekWindow {
  weekStart: string;
  dates: string[];
  start: Date;
  end: Date;
  zone: string;
}

export function weekWindow(weekStart: string, zone: string): WeekWindow {
  return {
    weekStart,
    dates: Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    start: startOfLocalDay(weekStart, zone),
    end: startOfLocalDay(addDays(weekStart, 7), zone),
    zone,
  };
}

export interface GridEntry {
  id: string;
  userId: string;
  projectId: string;
  taskId: string | null;
  isBillable: boolean;
  startedAt: Date;
  endedAt: Date | null;
  project: { id: string; name: string; color: string };
}

type Project = GridEntry['project'];

/**
 * Projects × days of one week, split at local midnight in the owner's timezone. Projects outside
 * `visibleProjectIds` (null = all) are summed into `otherSeconds` without names.
 */
export function buildWeekGrid(
  entries: readonly GridEntry[],
  week: WeekWindow,
  visibleProjectIds: ReadonlySet<string> | null,
) {
  const completed = entries.flatMap((e) =>
    e.endedAt ? [{ ...e, endedAt: e.endedAt, rateCents: null }] : [],
  );
  const portions = reportPortions(completed, { range: week, zone: week.zone, rounding: null });
  const rows = new Map<string, { project: Project; seconds: number[] }>();
  const otherSeconds = week.dates.map(() => 0);
  const dayTotals = week.dates.map(() => 0);

  for (const portion of portions) {
    const day = week.dates.indexOf(portion.date);
    if (day < 0) continue;
    dayTotals[day] = (dayTotals[day] ?? 0) + portion.seconds;
    const { project } = portion.entry;
    if (visibleProjectIds && !visibleProjectIds.has(project.id)) {
      otherSeconds[day] = (otherSeconds[day] ?? 0) + portion.seconds;
      continue;
    }
    const row = rows.get(project.id) ?? { project, seconds: week.dates.map(() => 0) };
    row.seconds[day] = (row.seconds[day] ?? 0) + portion.seconds;
    rows.set(project.id, row);
  }

  const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
  return {
    projects: [...rows.values()]
      .map((row) => ({ ...row, totalSeconds: sum(row.seconds) }))
      .sort((a, b) => a.project.name.localeCompare(b.project.name)),
    otherSeconds,
    dayTotals,
    totalSeconds: sum(dayTotals),
  };
}
