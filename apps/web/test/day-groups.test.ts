import { describe, expect, it } from 'vitest';
import { groupByDay } from '../src/lib/day-groups.ts';
import { entry } from './fixtures.ts';

const BERLIN = 'Europe/Berlin';

describe('groupByDay', () => {
  it('groups by local start day, newest first, splitting midnight-crossing totals', () => {
    // 22:00–02:00 Berlin (CEST): starts on the 21st, 2 h on each day.
    const late = entry('2026-10-21T20:00:00Z', '2026-10-22T00:00:00Z');
    const morning = entry('2026-10-22T07:00:00Z', '2026-10-22T08:30:00Z');
    const groups = groupByDay([late, morning], BERLIN, Date.parse('2026-10-22T12:00:00Z'));
    expect(groups.map((g) => [g.date, g.entries.map((e) => e.id), g.totalSeconds])).toEqual([
      ['2026-10-22', [morning.id], 7200 + 5400],
      ['2026-10-21', [late.id], 7200],
    ]);
  });

  it('uses the given zone: the same entry is one day in Yerevan', () => {
    const late = entry('2026-10-21T20:00:00Z', '2026-10-22T00:00:00Z');
    const groups = groupByDay([late], 'Asia/Yerevan', Date.parse('2026-10-22T12:00:00Z'));
    expect(groups.map((g) => [g.date, g.totalSeconds])).toEqual([['2026-10-22', 14_400]]);
  });

  it('counts a running entry up to now, and a 25-hour DST day in full', () => {
    const running = entry('2026-10-31T10:00:00Z', null);
    expect(groupByDay([running], BERLIN, Date.parse('2026-10-31T10:30:15Z'))[0]?.totalSeconds).toBe(
      1815,
    );
    const allDay = entry('2026-10-24T22:00:00Z', '2026-10-25T23:00:00Z');
    expect(
      groupByDay([allDay], BERLIN, Date.now()).find((g) => g.date === '2026-10-25')?.totalSeconds,
    ).toBe(25 * 3600);
  });

  it('keeps only days inside the range, but counts spill-over from the day before', () => {
    const late = entry('2026-10-21T20:00:00Z', '2026-10-22T00:00:00Z');
    const groups = groupByDay([late], BERLIN, Date.now(), { from: '2026-10-22', to: '2026-10-28' });
    expect(groups).toEqual([
      {
        date: '2026-10-22',
        entries: [],
        totalSeconds: 7200,
        carriedOver: [{ entry: late, seconds: 7200 }],
      },
    ]);
  });

  it('lists entries carried over from the day before (not on the day they start)', () => {
    const late = entry('2026-10-21T20:00:00Z', '2026-10-22T00:00:00Z');
    const groups = groupByDay([late], BERLIN, Date.now());
    expect(
      groups.map((g) => [g.date, g.entries.length, g.carriedOver.map((c) => c.seconds)]),
    ).toEqual([
      ['2026-10-22', 0, [7200]],
      ['2026-10-21', 1, []],
    ]);
  });
});
