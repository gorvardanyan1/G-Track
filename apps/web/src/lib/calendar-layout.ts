import { splitByLocalDay, toLocalDateTime, type TimeEntryResponse } from '@tempo/shared';

export const MINUTES_PER_DAY = 24 * 60;

export interface CalendarBlock {
  entry: TimeEntryResponse;
  date: string;
  /** Wall-clock minutes since local midnight. */
  startMinute: number;
  endMinute: number;
  /** Side-by-side lanes when blocks overlap on the wall clock (e.g. the repeated DST hour). */
  lane: number;
  lanes: number;
  /** True if the entry continues from the previous day / into the next day. */
  continuesBefore: boolean;
  continuesAfter: boolean;
}

const wallMinute = (instant: Date, zone: string) => {
  const time = toLocalDateTime(instant, zone).time;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + Number(time.slice(6, 8)) / 60;
};

/**
 * Lays entries out on a week of local days (`dates`), split at local midnight in `zone`. A block
 * is positioned by wall-clock time, so 09:00 is always at the 9 o'clock line, DST or not.
 */
export function layoutWeek(
  entries: readonly TimeEntryResponse[],
  dates: readonly string[],
  zone: string,
  nowMs: number,
): Map<string, CalendarBlock[]> {
  const days = new Map<string, CalendarBlock[]>(dates.map((d) => [d, []]));
  for (const entry of entries) {
    const start = new Date(entry.startedAt);
    const end = entry.endedAt
      ? new Date(entry.endedAt)
      : new Date(Math.max(nowMs, start.getTime() + 60_000));
    const portions = splitByLocalDay(start, end, zone);
    portions.forEach((portion, i) => {
      const blocks = days.get(portion.date);
      if (!blocks) return;
      const startMinute = i === 0 ? wallMinute(portion.start, zone) : 0;
      const last = i === portions.length - 1;
      const endMinute = last ? wallMinute(portion.end, zone) || MINUTES_PER_DAY : MINUTES_PER_DAY;
      blocks.push({
        entry,
        date: portion.date,
        startMinute,
        endMinute: Math.max(endMinute, startMinute + 1),
        lane: 0,
        lanes: 1,
        continuesBefore: i > 0,
        continuesAfter: !last,
      });
    });
  }
  for (const blocks of days.values()) assignLanes(blocks);
  return days;
}

/** Greedy lanes for overlapping blocks; each cluster of overlaps shares its lane count. */
function assignLanes(blocks: CalendarBlock[]): void {
  blocks.sort((a, b) => a.startMinute - b.startMinute || b.endMinute - a.endMinute);
  let cluster: CalendarBlock[] = [];
  let clusterEnd = -1;
  const laneEnds: number[] = [];
  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((b) => b.lane + 1));
    for (const block of cluster) block.lanes = lanes;
    cluster = [];
    laneEnds.length = 0;
  };
  for (const block of blocks) {
    if (block.startMinute >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= block.startMinute);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = block.endMinute;
    block.lane = lane;
    cluster.push(block);
    clusterEnd = Math.max(clusterEnd, block.endMinute);
  }
  flush();
}

/** Snaps a minute to the step (default 15 min), within the day. */
export function snapMinute(minute: number, step = 15): number {
  return Math.min(MINUTES_PER_DAY, Math.max(0, Math.round(minute / step) * step));
}

/** "HH:MM" for minutes since midnight (24:00 becomes 00:00 — the end then is the next day). */
export function minuteToTime(minute: number): string {
  const m = ((Math.round(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** The time range a drag selected, ordered and at least one step long. */
export function dragRange(fromMinute: number, toMinute: number, step = 15) {
  const a = snapMinute(Math.min(fromMinute, toMinute), step);
  let b = snapMinute(Math.max(fromMinute, toMinute), step);
  if (b - a < step) b = Math.min(MINUTES_PER_DAY, a + step);
  return { start: minuteToTime(a), end: minuteToTime(b), startMinute: a, endMinute: b };
}
