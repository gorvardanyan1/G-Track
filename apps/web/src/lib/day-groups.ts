import { splitByLocalDay, toLocalDate, type TimeEntryResponse } from '@tempo/shared';

export interface DayGroup {
  /** Local date in the user's timezone. */
  date: string;
  /** Entries that *start* on this day, newest first. */
  entries: TimeEntryResponse[];
  /** Time on this day, with entries crossing midnight split by their real portion. */
  totalSeconds: number;
  /** Entries that started on an earlier day and run into this one, with their time here. */
  carriedOver: { entry: TimeEntryResponse; seconds: number }[];
}

/**
 * Groups entries by the local day they start on (newest day first). Totals count each entry's
 * real portion per day (22:00–02:00 adds 2 h to each day); a running entry counts up to `nowMs`.
 */
export function groupByDay(
  entries: readonly TimeEntryResponse[],
  zone: string,
  nowMs: number,
  range?: { from: string; to: string },
): DayGroup[] {
  const groups = new Map<string, DayGroup>();
  const group = (date: string) => {
    let g = groups.get(date);
    if (!g) {
      g = { date, entries: [], totalSeconds: 0, carriedOver: [] };
      groups.set(date, g);
    }
    return g;
  };
  const inRange = (date: string) => !range || (date >= range.from && date <= range.to);

  for (const entry of entries) {
    const start = new Date(entry.startedAt);
    const end = entry.endedAt
      ? new Date(entry.endedAt)
      : new Date(Math.max(nowMs, start.getTime()));
    const startDate = toLocalDate(start, zone);
    if (inRange(startDate)) group(startDate).entries.push(entry);
    for (const portion of splitByLocalDay(start, end, zone)) {
      if (!inRange(portion.date)) continue;
      const g = group(portion.date);
      g.totalSeconds += portion.seconds;
      if (portion.date !== startDate) g.carriedOver.push({ entry, seconds: portion.seconds });
    }
  }
  const byStartDesc = (a: TimeEntryResponse, b: TimeEntryResponse) =>
    b.startedAt.localeCompare(a.startedAt);
  return [...groups.values()]
    .filter((g) => g.entries.length > 0 || g.totalSeconds > 0)
    .map((g) => ({ ...g, entries: g.entries.sort(byStartDesc) }))
    .sort((a, b) => b.date.localeCompare(a.date));
}
