import { addDays, isoWeekday, localDateTimeToUtc, todayInZone } from '@tempo/shared';
import type { SeedWorkerProfile } from './data.ts';
import type { Random } from './random.ts';

export interface WorkerAssignment {
  userId: string;
  timezone: string;
  profile: SeedWorkerProfile;
  projects: readonly {
    projectId: string;
    isBillable: boolean;
    tasks: readonly { taskId: string; descriptions: readonly string[] }[];
  }[];
}

export interface GeneratedEntry {
  userId: string;
  projectId: string;
  taskId: string | null;
  description: string;
  startedAt: Date;
  endedAt: Date | null;
  isBillable: boolean;
  source: 'TIMER' | 'MANUAL';
}

const MINUTE = 60_000;

function hhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Local wall-clock time → UTC. Seed times avoid 01:00–03:59, so DST never makes this ambiguous. */
function localToUtc(date: string, minutes: number, zone: string): Date {
  const result = localDateTimeToUtc(date, hhmm(minutes), zone, { ambiguous: 'earlier' });
  if (!result.ok)
    throw new Error(`Seed produced invalid local time ${date} ${hhmm(minutes)} ${zone}`);
  return result.utc;
}

/** Durations get random seconds, like real timers, but instants stay on whole seconds. */
function plusSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

function makeEntry(
  worker: WorkerAssignment,
  rng: Random,
  startedAt: Date,
  endedAt: Date | null,
): GeneratedEntry {
  const project = rng.pick(worker.projects);
  const task = rng.chance(0.85) ? rng.pick(project.tasks) : null;
  return {
    userId: worker.userId,
    projectId: project.projectId,
    taskId: task?.taskId ?? null,
    description: task
      ? rng.pick(task.descriptions)
      : rng.pick(['Planning', 'Team sync', 'Code review']),
    startedAt,
    endedAt,
    isBillable: project.isBillable && rng.chance(0.9),
    source: rng.chance(0.8) ? 'TIMER' : 'MANUAL',
  };
}

/**
 * Generates `weeks` of history for one worker, ending at `now`. Entries are produced in
 * strictly increasing order and never overlap; some evening sessions cross local midnight.
 */
export function generateWorkerEntries(
  worker: WorkerAssignment,
  rng: Random,
  now: Date,
  weeks: number,
): GeneratedEntry[] {
  const entries: GeneratedEntry[] = [];
  const { timezone: zone, profile } = worker;
  const today = todayInZone(zone, now);
  let lastEnd = new Date(0);

  // Adds a closed entry if it fits before `now`; returns false once we've reached the present.
  const push = (startedAt: Date, durationSeconds: number): boolean => {
    const start = startedAt < lastEnd ? lastEnd : startedAt;
    const end = plusSeconds(start, durationSeconds);
    if (end.getTime() > now.getTime()) return false;
    entries.push(makeEntry(worker, rng, start, end));
    lastEnd = end;
    return true;
  };

  for (let offset = -weeks * 7 + 1; offset <= 0; offset++) {
    const date = addDays(today, offset);
    const weekday = isoWeekday(date);
    const isWeekend = weekday >= 6;
    if (isWeekend ? !rng.chance(0.08) : rng.chance(0.05)) continue; // weekends off, rare day off

    const [earliest, latest] = profile.dayStartMinutes;
    let cursor = localToUtc(date, rng.int(earliest / 5, latest / 5) * 5, zone);
    const targetSeconds = (isWeekend ? rng.int(60, 150) : rng.int(390, 510)) * 60;
    let worked = 0;
    let hadLunch = false;
    let reachedNow = false;

    while (targetSeconds - worked >= 10 * 60) {
      const seconds = Math.min(rng.int(25, 150) * 60 + rng.int(0, 59), targetSeconds - worked + 59);
      if (!push(cursor, seconds)) {
        reachedNow = true;
        break;
      }
      worked += seconds;
      const breakMinutes: number =
        !hadLunch && worked > 3.5 * 3600 ? rng.int(30, 60) : rng.int(0, 15);
      hadLunch ||= breakMinutes >= 30;
      cursor = new Date(lastEnd.getTime() + breakMinutes * MINUTE);
    }
    if (reachedNow) break;

    if (!isWeekend && rng.chance(profile.lateNightChance)) {
      // 22:00–23:20 local, 1.5–3.5 h long: ends after midnight, well before the next morning.
      const lateStart = localToUtc(date, rng.int(22 * 12, 23 * 12 + 4) * 5, zone);
      if (!push(lateStart, rng.int(90, 210) * 60 + rng.int(0, 59))) break;
    }
  }

  if (profile.runningNow) {
    const proposed = new Date(now.getTime() - rng.int(15, 75) * MINUTE);
    const startedAt = new Date(
      Math.floor(Math.max(proposed.getTime(), lastEnd.getTime() + MINUTE) / 1000) * 1000,
    );
    if (startedAt < now) entries.push(makeEntry(worker, rng, startedAt, null));
  }

  return entries;
}
