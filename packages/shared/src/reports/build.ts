import { addDays } from '../time/calendar.ts';
import type { TimeRange } from '../time/ranges.ts';
import { roundDuration, type RoundingRule } from '../time/rounding.ts';
import { splitByLocalDay } from '../time/split.ts';

/** A completed time entry as reports need it. */
export interface ReportEntryInput {
  id: string;
  userId: string;
  projectId: string;
  taskId: string | null;
  isBillable: boolean;
  startedAt: Date;
  endedAt: Date;
  /** The user's hourly rate on the project in cents; null when no rate is set. */
  rateCents: number | null;
}

/** The part of one entry that falls on one local day of the report. */
export interface ReportPortion<E extends ReportEntryInput = ReportEntryInput> {
  entry: E;
  /** Local date in the report's timezone. */
  date: string;
  start: Date;
  end: Date;
  /** Real seconds of this portion. */
  rawSeconds: number;
  /** This portion's share of the entry's rounded duration (= rawSeconds without rounding). */
  seconds: number;
  billableSeconds: number;
  amountCents: number;
}

export interface ReportOptions {
  range: TimeRange;
  zone: string;
  /** Null or 0 minutes: no rounding. */
  rounding: RoundingRule | null;
}

/**
 * Shares `total` across parts proportionally to `weights`, using cumulative rounding so the
 * shares are whole, never negative and always add up to exactly `total`.
 */
function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  let cumulative = 0;
  let allocated = 0;
  return weights.map((weight) => {
    cumulative += weight;
    const upTo = Math.round((total * cumulative) / sum);
    const share = upTo - allocated;
    allocated = upTo;
    return share;
  });
}

/**
 * Clips each entry to the report range, rounds it once (if rounding is on) and splits it into
 * local-day portions in `zone`: an entry from 22:00 to 02:00 counts 2 h on each day. Rounded
 * time and money are shared across the portions so every breakdown adds up to the same total.
 * Amounts are billable rounded hours × hourly rate, rounded to whole cents per entry.
 */
export function reportPortions<E extends ReportEntryInput>(
  entries: readonly E[],
  { range, zone, rounding }: ReportOptions,
): ReportPortion<E>[] {
  const portions: ReportPortion<E>[] = [];
  const sorted = [...entries].sort(
    (a, b) => a.startedAt.getTime() - b.startedAt.getTime() || a.id.localeCompare(b.id),
  );
  for (const entry of sorted) {
    const start = new Date(Math.max(entry.startedAt.getTime(), range.start.getTime()));
    const end = new Date(Math.min(entry.endedAt.getTime(), range.end.getTime()));
    if (end <= start) continue;

    const parts = splitByLocalDay(start, end, zone).filter((p) => p.seconds > 0);
    const raw = parts.map((p) => p.seconds);
    const rawTotal = raw.reduce((a, b) => a + b, 0);
    const rounded = rounding ? roundDuration(rawTotal, rounding) : rawTotal;
    const seconds = allocate(rounded, raw);
    const priced = entry.isBillable && entry.rateCents !== null;
    const amountCents = priced
      ? allocate(Math.round((rounded * (entry.rateCents ?? 0)) / 3600), seconds)
      : seconds.map(() => 0);

    parts.forEach((part, i) => {
      portions.push({
        entry,
        date: part.date,
        start: part.start,
        end: part.end,
        rawSeconds: part.seconds,
        seconds: seconds[i] ?? 0,
        billableSeconds: entry.isBillable ? (seconds[i] ?? 0) : 0,
        amountCents: amountCents[i] ?? 0,
      });
    });
  }
  return portions;
}

export interface ReportTotals {
  seconds: number;
  billableSeconds: number;
  amountCents: number;
}

export interface ReportSummary {
  totals: ReportTotals & { rawSeconds: number; entryCount: number };
  /** Every date of the range, including days without time. */
  byDay: (ReportTotals & { date: string })[];
  byProject: (ReportTotals & { projectId: string })[];
  byTask: (ReportTotals & { projectId: string; taskId: string | null })[];
  byUser: (ReportTotals & { userId: string })[];
}

const zero = (): ReportTotals => ({ seconds: 0, billableSeconds: 0, amountCents: 0 });

function add(target: ReportTotals, portion: ReportPortion): void {
  target.seconds += portion.seconds;
  target.billableSeconds += portion.billableSeconds;
  target.amountCents += portion.amountCents;
}

function groupBy<K>(portions: readonly ReportPortion[], key: (p: ReportPortion) => K) {
  const groups = new Map<K, ReportTotals>();
  for (const portion of portions) {
    const k = key(portion);
    const totals = groups.get(k) ?? zero();
    add(totals, portion);
    groups.set(k, totals);
  }
  return groups;
}

/** Most time first; ties by key, so output is stable. */
const bySecondsDesc = <T extends ReportTotals>(rows: (T & { sortKey: string })[]) =>
  rows
    .sort((a, b) => b.seconds - a.seconds || a.sortKey.localeCompare(b.sortKey))
    .map(({ sortKey: _sortKey, ...row }) => row);

/** Totals and breakdowns of portions; `fromDate`/`toDate` (inclusive) zero-fill the days. */
export function summarizeReport(
  portions: readonly ReportPortion[],
  fromDate: string,
  toDate: string,
): ReportSummary {
  const totals = { ...zero(), rawSeconds: 0, entryCount: 0 };
  const entryIds = new Set<string>();
  for (const portion of portions) {
    add(totals, portion);
    totals.rawSeconds += portion.rawSeconds;
    entryIds.add(portion.entry.id);
  }
  totals.entryCount = entryIds.size;

  const days = groupBy(portions, (p) => p.date);
  const byDay: ReportSummary['byDay'] = [];
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    byDay.push({ date, ...(days.get(date) ?? zero()) });
  }

  const taskKey = (p: ReportPortion) => `${p.entry.projectId}:${p.entry.taskId ?? ''}`;
  return {
    totals,
    byDay,
    byProject: bySecondsDesc(
      [...groupBy(portions, (p) => p.entry.projectId)].map(([projectId, t]) => ({
        projectId,
        ...t,
        sortKey: projectId,
      })),
    ),
    byTask: bySecondsDesc(
      [...groupBy(portions, taskKey)].map(([key, t]) => {
        const [projectId = '', taskId = ''] = key.split(':');
        return { projectId, taskId: taskId || null, ...t, sortKey: key };
      }),
    ),
    byUser: bySecondsDesc(
      [...groupBy(portions, (p) => p.entry.userId)].map(([userId, t]) => ({
        userId,
        ...t,
        sortKey: userId,
      })),
    ),
  };
}
