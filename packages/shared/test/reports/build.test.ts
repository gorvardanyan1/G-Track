import { describe, expect, it } from 'vitest';
import {
  dayRange,
  reportPortions,
  startOfLocalDay,
  summarizeReport,
  type ReportEntryInput,
  type ReportOptions,
} from '../../src/index.ts';

const BERLIN = 'Europe/Berlin';

let seq = 0;
function entry(
  start: string,
  end: string,
  extra: Partial<ReportEntryInput> = {},
): ReportEntryInput {
  seq += 1;
  return {
    id: `e${String(seq).padStart(3, '0')}`,
    userId: 'u1',
    projectId: 'p1',
    taskId: null,
    isBillable: true,
    startedAt: new Date(start),
    endedAt: new Date(end),
    rateCents: null,
    ...extra,
  };
}

function options(
  from: string,
  to: string,
  zone = BERLIN,
  rounding: ReportOptions['rounding'] = null,
) {
  return {
    range: { start: startOfLocalDay(from, zone), end: dayRange(to, zone).end },
    zone,
    rounding,
  };
}

const simplify = (portions: ReturnType<typeof reportPortions>) =>
  portions.map((p) => [p.date, p.rawSeconds, p.seconds, p.amountCents]);

describe('reportPortions', () => {
  it('splits a 22:00–02:00 entry 2 h / 2 h across both local days', () => {
    // 22:00 CEST (UTC+2) on Oct 20 = 20:00Z; 02:00 on Oct 21 = 00:00Z.
    const e = entry('2026-10-20T20:00:00Z', '2026-10-21T00:00:00Z');
    expect(simplify(reportPortions([e], options('2026-10-20', '2026-10-21')))).toEqual([
      ['2026-10-20', 7200, 7200, 0],
      ['2026-10-21', 7200, 7200, 0],
    ]);
  });

  it('splits by the requesting zone, not the entry owner’s', () => {
    // Same instants in Asia/Yerevan (UTC+4): 00:00–04:00 on Oct 21, all on one day.
    const e = entry('2026-10-20T20:00:00Z', '2026-10-21T00:00:00Z');
    expect(
      simplify(reportPortions([e], options('2026-10-20', '2026-10-21', 'Asia/Yerevan'))),
    ).toEqual([['2026-10-21', 14_400, 14_400, 0]]);
  });

  it('clips entries to the report range', () => {
    const e = entry('2026-10-20T20:00:00Z', '2026-10-21T00:00:00Z');
    expect(simplify(reportPortions([e], options('2026-10-21', '2026-10-21')))).toEqual([
      ['2026-10-21', 7200, 7200, 0],
    ]);
    expect(reportPortions([e], options('2026-10-22', '2026-10-23'))).toEqual([]);
  });

  it('counts the 25-hour fall-back day (Oct 25 in Berlin) in full', () => {
    const e = entry(
      startOfLocalDay('2026-10-25', BERLIN).toISOString(),
      startOfLocalDay('2026-10-26', BERLIN).toISOString(),
    );
    expect(simplify(reportPortions([e], options('2026-10-25', '2026-10-25')))).toEqual([
      ['2026-10-25', 90_000, 90_000, 0],
    ]);
  });

  it('rounds once per entry and shares the rounded time across the days', () => {
    // 23:50–00:10 local = 20 min, 10 min on each day.
    const e = entry('2026-10-20T21:50:00Z', '2026-10-20T22:10:00Z');
    const opts = (mode: 'NEAREST' | 'UP' | 'DOWN') =>
      options('2026-10-20', '2026-10-21', BERLIN, { minutes: 15, mode });
    // 20 min → 15 min (nearest), 30 min (up), 15 min (down), shared 50/50.
    expect(simplify(reportPortions([e], opts('NEAREST')))).toEqual([
      ['2026-10-20', 600, 450, 0],
      ['2026-10-21', 600, 450, 0],
    ]);
    expect(simplify(reportPortions([e], opts('UP')))).toEqual([
      ['2026-10-20', 600, 900, 0],
      ['2026-10-21', 600, 900, 0],
    ]);
    expect(simplify(reportPortions([e], opts('DOWN')))).toEqual([
      ['2026-10-20', 600, 450, 0],
      ['2026-10-21', 600, 450, 0],
    ]);
  });

  it('never makes a portion negative when rounding down to zero', () => {
    // 14 min across midnight (7 + 7), DOWN to 15 → 0.
    const e = entry('2026-10-20T21:53:00Z', '2026-10-20T22:07:00Z');
    const portions = reportPortions(
      [e],
      options('2026-10-20', '2026-10-21', BERLIN, { minutes: 15, mode: 'DOWN' }),
    );
    expect(portions.map((p) => p.seconds)).toEqual([0, 0]);
  });

  it('prices billable time per entry in whole cents, shared by seconds', () => {
    // 22:00–01:30 local at 80.00/h: 3.5 h = 280.00, i.e. 160.00 + 120.00.
    const e = entry('2026-10-20T20:00:00Z', '2026-10-20T23:30:00Z', { rateCents: 8000 });
    expect(simplify(reportPortions([e], options('2026-10-20', '2026-10-21')))).toEqual([
      ['2026-10-20', 7200, 7200, 16_000],
      ['2026-10-21', 5400, 5400, 12_000],
    ]);
  });

  it('rounds money half up to the cent', () => {
    // 1 min at 0.50/h = 0.8333… cents → 1 cent; 59 s at 0.10/h = 0.1639 cents → 0.
    const a = entry('2026-10-20T08:00:00Z', '2026-10-20T08:01:00Z', { rateCents: 50 });
    const b = entry('2026-10-20T09:00:00Z', '2026-10-20T09:00:59Z', { rateCents: 10 });
    expect(
      reportPortions([a, b], options('2026-10-20', '2026-10-20')).map((p) => p.amountCents),
    ).toEqual([1, 0]);
  });

  it('non-billable time has no amount; billable time without a rate has amount 0', () => {
    const nonBillable = entry('2026-10-20T08:00:00Z', '2026-10-20T09:00:00Z', {
      isBillable: false,
      rateCents: 8000,
    });
    const unrated = entry('2026-10-20T10:00:00Z', '2026-10-20T11:00:00Z');
    const portions = reportPortions([nonBillable, unrated], options('2026-10-20', '2026-10-20'));
    expect(portions.map((p) => [p.billableSeconds, p.amountCents])).toEqual([
      [0, 0],
      [3600, 0],
    ]);
  });
});

describe('summarizeReport', () => {
  const entries = [
    // p1/t1, u1, rate 80: 22:00–02:00 across Oct 20/21 (4 h).
    entry('2026-10-20T20:00:00Z', '2026-10-21T00:00:00Z', {
      taskId: 't1',
      rateCents: 8000,
    }),
    // p1/no task, u2, rate 100: 09:07–10:00 on Oct 21 (53 min).
    entry('2026-10-21T07:07:00Z', '2026-10-21T08:00:00Z', { userId: 'u2', rateCents: 10_000 }),
    // p2, u1, non-billable: 13:00–13:20 on Oct 22 (20 min).
    entry('2026-10-22T11:00:00Z', '2026-10-22T11:20:00Z', { projectId: 'p2', isBillable: false }),
  ];

  it('totals, days, projects, tasks and users without rounding', () => {
    const s = summarizeReport(
      reportPortions(entries, options('2026-10-19', '2026-10-22')),
      '2026-10-19',
      '2026-10-22',
    );
    // 14_400 + 3180 + 1200 = 18_780 s; billable 17_580 s;
    // amounts: 4 h × 80 = 320.00, 53 min × 100 = 88.33 (88.333…).
    expect(s.totals).toEqual({
      seconds: 18_780,
      rawSeconds: 18_780,
      billableSeconds: 17_580,
      amountCents: 32_000 + 8833,
      entryCount: 3,
    });
    expect(s.byDay.map((d) => [d.date, d.seconds, d.amountCents])).toEqual([
      ['2026-10-19', 0, 0],
      ['2026-10-20', 7200, 16_000],
      ['2026-10-21', 7200 + 3180, 16_000 + 8833],
      ['2026-10-22', 1200, 0],
    ]);
    expect(s.byProject.map((p) => [p.projectId, p.seconds, p.billableSeconds])).toEqual([
      ['p1', 17_580, 17_580],
      ['p2', 1200, 0],
    ]);
    expect(s.byTask.map((t) => [t.projectId, t.taskId, t.seconds])).toEqual([
      ['p1', 't1', 14_400],
      ['p1', null, 3180],
      ['p2', null, 1200],
    ]);
    expect(s.byUser.map((u) => [u.userId, u.seconds, u.amountCents])).toEqual([
      ['u1', 15_600, 32_000],
      ['u2', 3180, 8833],
    ]);
  });

  it('with rounding every breakdown adds up to the same total', () => {
    const s = summarizeReport(
      reportPortions(
        entries,
        options('2026-10-19', '2026-10-22', BERLIN, { minutes: 15, mode: 'NEAREST' }),
      ),
      '2026-10-19',
      '2026-10-22',
    );
    // 4 h stays 4 h; 53 min → 60 min (100.00); 20 min → 15 min.
    expect(s.totals).toMatchObject({
      seconds: 14_400 + 3600 + 900,
      rawSeconds: 18_780,
      amountCents: 42_000,
    });
    const sum = (rows: { seconds: number }[]) => rows.reduce((a, r) => a + r.seconds, 0);
    for (const rows of [s.byDay, s.byProject, s.byTask, s.byUser]) expect(sum(rows)).toBe(18_900);
  });

  it('zero-fills every date of an empty range', () => {
    const s = summarizeReport([], '2026-02-27', '2026-03-01');
    expect(s.byDay.map((d) => d.date)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
    expect(s.totals).toEqual({
      seconds: 0,
      rawSeconds: 0,
      billableSeconds: 0,
      amountCents: 0,
      entryCount: 0,
    });
  });
});
