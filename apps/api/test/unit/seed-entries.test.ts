import { describe, expect, it } from 'vitest';
import { toLocalDate } from '@tempo/shared';
import { WORKER_PROFILES } from '../../prisma/seed/data.ts';
import { generateWorkerEntries, type WorkerAssignment } from '../../prisma/seed/entries.ts';
import { createRandom } from '../../prisma/seed/random.ts';

const NOW = new Date('2026-10-31T15:00:00.123Z');

function worker(timezone: string, profileKey: string): WorkerAssignment {
  const profile = WORKER_PROFILES[profileKey];
  if (!profile) throw new Error(profileKey);
  return {
    userId: 'u1',
    timezone,
    profile,
    projects: [
      { projectId: 'p1', isBillable: true, tasks: [{ taskId: 't1', descriptions: ['Work'] }] },
      { projectId: 'p2', isBillable: false, tasks: [{ taskId: 't2', descriptions: ['Other'] }] },
    ],
  };
}

const cases = [
  ['Asia/Yerevan', 'davit'],
  ['Europe/Berlin', 'jonas'],
  ['America/New_York', 'ethan'],
  ['America/New_York', 'sofia'],
] as const;

describe.each(cases)('generateWorkerEntries (%s, %s)', (timezone, profileKey) => {
  const entries = generateWorkerEntries(worker(timezone, profileKey), createRandom(42), NOW, 6);
  const closed = entries.filter((e) => e.endedAt !== null);

  it('produces sorted, non-overlapping entries', () => {
    for (let i = 1; i < entries.length; i++) {
      const prev = entries[i - 1];
      const current = entries[i];
      expect(prev?.endedAt).not.toBeNull();
      expect(current!.startedAt.getTime()).toBeGreaterThanOrEqual(prev!.endedAt!.getTime());
    }
  });

  it('uses whole-second instants and positive durations', () => {
    for (const e of entries) {
      expect(e.startedAt.getMilliseconds()).toBe(0);
      if (e.endedAt) {
        expect(e.endedAt.getMilliseconds()).toBe(0);
        expect(e.endedAt.getTime()).toBeGreaterThan(e.startedAt.getTime());
      }
    }
  });

  it('never extends past now and runs at most one timer', () => {
    expect(entries.filter((e) => e.endedAt === null).length).toBeLessThanOrEqual(1);
    for (const e of entries)
      expect((e.endedAt ?? e.startedAt).getTime()).toBeLessThanOrEqual(NOW.getTime());
  });

  it('covers six weeks', () => {
    const first = entries[0]?.startedAt.getTime() ?? 0;
    expect(NOW.getTime() - first).toBeGreaterThan(5 * 7 * 86_400_000);
    expect(closed.length).toBeGreaterThan(100);
  });

  it('keeps non-billable projects non-billable', () => {
    expect(entries.filter((e) => e.projectId === 'p2' && e.isBillable)).toHaveLength(0);
  });
});

describe('generateWorkerEntries midnight crossing', () => {
  it('creates sessions that cross local midnight for night owls', () => {
    const entries = generateWorkerEntries(
      worker('America/New_York', 'ethan'),
      createRandom(7),
      NOW,
      6,
    );
    const crossing = entries.filter(
      (e) =>
        e.endedAt &&
        toLocalDate(e.startedAt, 'America/New_York') !== toLocalDate(e.endedAt, 'America/New_York'),
    );
    expect(crossing.length).toBeGreaterThan(0);
  });

  it('is deterministic for the same seed and clock', () => {
    const a = generateWorkerEntries(worker('Europe/Berlin', 'lena'), createRandom(1), NOW, 6);
    const b = generateWorkerEntries(worker('Europe/Berlin', 'lena'), createRandom(1), NOW, 6);
    expect(a).toEqual(b);
  });
});
