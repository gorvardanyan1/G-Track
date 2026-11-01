import { inflateSync } from 'node:zlib';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { reportResponseSchema, type ReportResponse } from '@tempo/shared';
import { createHarness, prisma, resetDatabase, type Harness } from '../auth/harness.ts';
import { createScenario, type Scenario } from '../org/scenario.ts';
import { errorBody, insertEntry, setOrgSettings, setTimezone } from '../tracking/fixtures.ts';
import { createReportDataset, WEEK } from './dataset.ts';

let h: Harness;
let s: Scenario;

beforeEach(async () => {
  await resetDatabase();
  h = createHarness();
  h.setNow('2026-11-01T12:00:00Z');
  s = await createScenario(h);
  await createReportDataset(s);
});
afterAll(async () => {
  await prisma().$disconnect();
});

type Who = Parameters<Scenario['as']>[0];
const query = (params: Record<string, string | string[]>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    for (const v of [value].flat()) search.append(key, v);
  return search.toString();
};
async function report(who: Who, params: Record<string, string | string[]> = {}) {
  const res = await s.as(who).get(`/reports?${query({ ...WEEK, ...params })}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return reportResponseSchema.parse(res.body);
}
const days = (r: ReportResponse) => r.byDay.map((d) => [d.date, d.seconds, d.amountCents]);
const sum = (rows: { seconds: number }[]) => rows.reduce((a, r) => a + r.seconds, 0);

describe('report totals match the hand-calculated dataset', () => {
  it('Super Admin in Berlin, no rounding', async () => {
    const r = await report('admin');
    // 3600 + 2220 + 9000 + 14400 + 3000 + 10800 = 43 020 s; E3 (3000 s) is not billable.
    expect(r.totals).toEqual({
      seconds: 43_020,
      rawSeconds: 43_020,
      billableSeconds: 40_020,
      amountCents: 90_700,
      entryCount: 6,
    });
    expect(r.rounding).toBeNull();
    expect(r.timezone).toBe('Europe/Berlin');
    expect(days(r)).toEqual([
      ['2026-10-19', 3600 + 2220, 8000 + 3700],
      ['2026-10-20', 9000, 20_000],
      // E2 22:00–02:00 counts 2 h on each day.
      ['2026-10-21', 7200, 16_000],
      ['2026-10-22', 7200, 16_000],
      ['2026-10-23', 3000, 0],
      ['2026-10-24', 0, 0],
      // E4 00:30–02:30 local on the 25-hour fall-back day.
      ['2026-10-25', 10_800, 27_000],
    ]);
    expect(
      r.byProject.map((p) => [p.project.name, p.seconds, p.billableSeconds, p.amountCents]),
    ).toEqual([
      ['Project A', 32_220, 29_220, 63_700],
      ['Project B', 10_800, 10_800, 27_000],
    ]);
    expect(r.byProject[0]?.project.clientName).toBe('Northwind');
    expect(
      r.byTask.map((t) => [t.project.name, t.task?.name ?? null, t.seconds, t.amountCents]),
    ).toEqual([
      ['Project A', null, 14_400 + 2220, 32_000 + 3700],
      ['Project A', 'Design', 3600 + 9000 + 3000, 8000 + 20_000],
      ['Project B', 'Build', 10_800, 27_000],
    ]);
    expect(r.byUser.map((u) => [u.user.name, u.seconds, u.billableSeconds, u.amountCents])).toEqual(
      [
        ['Anahit Worker', 30_000, 27_000, 60_000],
        ['Bob Worker', 13_020, 13_020, 30_700],
      ],
    );
  });

  it('with the org rounding rule (15 min, nearest), applied once per entry', async () => {
    await setOrgSettings({ roundingMinutes: 15, roundingMode: 'NEAREST' });
    const r = await report('admin', { round: 'true' });
    // E3 50 min → 45 min; E5 37 min → 30 min (60.00/h → 30.00); everything else is on the quarter.
    expect(r.rounding).toEqual({ minutes: 15, mode: 'NEAREST' });
    expect(r.totals).toMatchObject({ seconds: 42_300, rawSeconds: 43_020, amountCents: 90_000 });
    for (const rows of [r.byDay, r.byProject, r.byTask, r.byUser]) expect(sum(rows)).toBe(42_300);
    expect(days(r)[0]).toEqual(['2026-10-19', 3600 + 1800, 8000 + 3000]);
    // Without ?round=true the stored, exact durations are reported.
    expect((await report('admin')).totals.seconds).toBe(43_020);
  });

  it('splits days in the requesting user’s timezone (New York)', async () => {
    await setTimezone(s.users.admin.id, 'America/New_York');
    const r = await report('admin');
    // The NY week starts at 04:00Z on Oct 19: E6 (Oct 18 17:00–19:00 EDT) falls outside;
    // E2 is 16:00–20:00 on Oct 21 and E4 18:30–21:30 on Oct 24, each on a single day.
    expect(r.timezone).toBe('America/New_York');
    expect(r.totals.seconds).toBe(43_020 - 3600);
    expect(days(r).map(([date, seconds]) => [date, seconds])).toEqual([
      ['2026-10-19', 2220],
      ['2026-10-20', 9000],
      ['2026-10-21', 14_400],
      ['2026-10-22', 0],
      ['2026-10-23', 3000],
      ['2026-10-24', 10_800],
      ['2026-10-25', 0],
    ]);
  });

  it('filters by billable, project, task, client and user', async () => {
    expect((await report('admin', { billable: 'false' })).totals.seconds).toBe(3000);
    expect((await report('admin', { projectId: s.projectB.id })).totals.seconds).toBe(10_800);
    expect((await report('admin', { taskId: s.taskA.id })).totals.seconds).toBe(15_600);
    expect((await report('admin', { clientId: s.client.id })).totals.seconds).toBe(43_020);
    expect(
      (await report('admin', { userId: [s.users.workerA.id, s.users.workerB.id] })).totals.seconds,
    ).toBe(43_020);
    expect((await report('admin', { userId: `${s.users.workerB.id}` })).totals.seconds).toBe(
      13_020,
    );
  });

  it('does not count running timers', async () => {
    await insertEntry({
      userId: s.users.workerB.id,
      projectId: s.projectB.id,
      // After workerB's last entry, still inside the week.
      startedAt: '2026-10-25T02:00:00Z',
      endedAt: null,
      source: 'TIMER',
    });
    expect((await report('admin')).totals.seconds).toBe(43_020);
  });
});

describe('who sees what', () => {
  it('a PM sees only their projects (with amounts), including other workers on them', async () => {
    const a = await report('pmA');
    expect(a.byProject.map((p) => p.project.name)).toEqual(['Project A']);
    expect(a.totals).toMatchObject({ seconds: 32_220, amountCents: 63_700 });
    expect(a.byUser.map((u) => [u.user.name, u.seconds])).toEqual([
      ['Anahit Worker', 30_000],
      ['Bob Worker', 2220],
    ]);
    const b = await report('pmB');
    expect(b.totals).toMatchObject({ seconds: 10_800, amountCents: 27_000 });
    expect((await report('pmA', { userId: s.users.workerB.id })).totals.seconds).toBe(2220);
  });

  it('a worker sees only their own time, without amounts', async () => {
    const r = await report('workerA');
    expect(r.totals).toMatchObject({ seconds: 30_000, amountCents: null });
    expect(r.byDay.every((d) => d.amountCents === null)).toBe(true);
    expect((await report('outsider')).totals.seconds).toBe(0);
  });

  it.each([
    ['workerA', 'projectId', 'projectB'],
    ['workerA', 'userId', 'workerB'],
    ['workerA', 'taskId', 'taskB'],
    ['pmA', 'projectId', 'projectB'],
    ['pmA', 'userId', 'outsider'],
    ['pmA', 'taskId', 'taskB'],
    ['pmB', 'userId', 'workerA'],
    ['outsider', 'clientId', 'client'],
  ] as const)('%s filtering by %s=%s gets 404', async (who, param, target) => {
    const ids: Record<string, string> = {
      projectB: s.projectB.id,
      workerB: s.users.workerB.id,
      workerA: s.users.workerA.id,
      outsider: s.users.outsider.id,
      taskB: s.taskB.id,
      client: s.client.id,
    };
    const res = await s.as(who).get(`/reports?${query({ ...WEEK, [param]: ids[target] ?? '' })}`);
    expect(res.status).toBe(404);
  });

  it('unknown ids are 404 for admins too; bad input is 400', async () => {
    const unknown = '0190e5b2-0000-7000-8000-000000000000';
    expect(
      (await s.as('admin').get(`/reports?${query({ ...WEEK, projectId: unknown })}`)).status,
    ).toBe(404);
    const tooLong = await s.as('admin').get('/reports?from=2026-01-01&to=2027-01-02');
    expect(errorBody(tooLong).code).toBe('VALIDATION_ERROR');
    expect((await s.as('admin').get('/reports?from=2026-10-25&to=2026-10-19')).status).toBe(400);
    expect(
      (await s.as('admin').get(`/reports?${query({ ...WEEK, projectId: 'nope' })}`)).status,
    ).toBe(400);
    expect((await h.api().get(`/reports?${query(WEEK)}`)).status).toBe(401);
  });
});

describe('CSV export', () => {
  const csv = async (who: Who, params: Record<string, string> = {}) => {
    const res = await s.as(who).get(`/reports/export.csv?${query({ ...WEEK, ...params })}`);
    expect(res.status).toBe(200);
    return res;
  };
  const rows = (text: string) =>
    text
      .replace(/^\uFEFF/, '')
      .trimEnd()
      .split('\r\n');

  it('has one row per entry per day, adding up to the report total', async () => {
    const res = await csv('admin');
    expect(res.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(res.headers['content-disposition']).toBe(
      'attachment; filename=tempo-report-2026-10-19_2026-10-25.csv',
    );
    expect(res.text.startsWith('\uFEFF')).toBe(true);
    const lines = rows(res.text);
    expect(lines[0]).toBe(
      'Date,Start,End,User,Client,Project,Task,Description,Billable,Duration,Duration (h),Amount,Entry ID',
    );
    // 6 entries, E2 split into two rows, plus the total row.
    expect(lines).toHaveLength(1 + 7 + 1);
    expect(lines[1]).toMatch(
      /^2026-10-19,00:00:00,01:00:00,Anahit Worker,Northwind,Project A,Design,Late wireframes,Yes,01:00:00,1\.00,80\.00,/,
    );
    expect(lines[4]).toMatch(
      /^2026-10-21,22:00:00,24:00:00,.*,Release night,Yes,02:00:00,2\.00,160\.00,/,
    );
    expect(lines[5]).toMatch(
      /^2026-10-22,00:00:00,02:00:00,.*,Release night,Yes,02:00:00,2\.00,160\.00,/,
    );
    // Quotes are escaped and formulas neutralized.
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil.test"")"`);
    expect(res.text).toContain('"Migration, ""phase 2"""');
    expect(lines.at(-1)).toBe('Total,,,,,,,,,11:57:00,11.95,907.00,');
  });

  it('adds the actual duration when rounded and leaves amounts out for workers', async () => {
    await setOrgSettings({ roundingMinutes: 15, roundingMode: 'NEAREST' });
    const rounded = rows((await csv('admin', { round: 'true' })).text);
    expect(rounded[0]).toContain('Duration,Duration (h),Actual duration,Amount');
    expect(rounded.at(-1)).toBe('Total,,,,,,,,,11:45:00,11.75,11:57:00,900.00,');

    const worker = rows((await csv('workerA')).text);
    expect(worker[0]).not.toContain('Amount');
    expect(worker.at(-1)).toBe('Total,,,,,,,,,08:20:00,8.33,');
  });
});

describe('PDF export', () => {
  const pdf = async (who: Who) => {
    const res = await s
      .as(who)
      .get(`/reports/export.pdf?${query(WEEK)}`)
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (c: Buffer) => chunks.push(c));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    return { res, file: res.body as Buffer };
  };
  /** All page text, from the compressed content streams. */
  const text = (file: Buffer) => {
    const out: string[] = [];
    const latin = file.toString('latin1');
    for (const match of latin.matchAll(/stream\n([\s\S]*?)\nendstream/g)) {
      const start = (match.index ?? 0) + 'stream\n'.length;
      out.push(
        inflateSync(
          file.subarray(start, start + Buffer.byteLength(match[1] ?? '', 'latin1')),
        ).toString('latin1'),
      );
    }
    return out.join('\n');
  };

  it('is a well-formed PDF with the totals and breakdowns', async () => {
    const { res, file } = await pdf('admin');
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toContain('tempo-report-2026-10-19_2026-10-25.pdf');
    const latin = file.toString('latin1');
    expect(latin.startsWith('%PDF-1.4')).toBe(true);
    expect(latin.trimEnd().endsWith('%%EOF')).toBe(true);
    // Every xref offset points at its object.
    const xref = Number(/startxref\n(\d+)/.exec(latin)?.[1]);
    const entries = latin
      .slice(xref)
      .split('\n')
      .slice(3)
      .filter((l) => / 00000 n $/.test(l));
    entries.forEach((line, i) => {
      expect(latin.slice(Number(line.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true);
    });

    const content = text(file);
    for (const expected of [
      '(Time report)',
      '(11:57:00)',
      '(907.00)',
      '(Project A)',
      '(Bob Worker)',
      '(Release night)',
      '(22:00\x9624:00)',
    ]) {
      expect(content).toContain(expected);
    }
  });

  it('has no amounts for workers', async () => {
    const content = text((await pdf('workerA')).file);
    expect(content).toContain('(08:20:00)');
    expect(content).not.toContain('(Amount)');
    expect(content).not.toContain('(Bob Worker)');
  });
});
