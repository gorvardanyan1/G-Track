import { prisma } from '../auth/harness.ts';
import type { Scenario } from '../org/scenario.ts';
import { insertEntry } from '../tracking/fixtures.ts';

/**
 * A small, hand-calculated dataset for the week Mon 2026-10-19 – Sun 2026-10-25. Europe/Berlin
 * is on CEST (UTC+2) until it falls back on Sun 25 Oct at 01:00Z; New York is on EDT (UTC−4).
 *
 * Rates: workerA on Project A 80.00/h; workerB on Project A 60.00/h (added here), on B 90.00/h.
 *
 *  id  who      project/task  billable  UTC                          Berlin local               secs
 *  E6  workerA  A / Design    yes       Oct 18 21:00 – 23:00         Oct 18 23:00 – Oct 19 01:00  7200 (3600 in range)
 *  E5  workerB  A / —         yes       Oct 19 05:53 – 06:30         Oct 19 07:53 – 08:30         2220
 *  E1  workerA  A / Design    yes       Oct 20 07:00 – 09:30         Oct 20 09:00 – 11:30         9000
 *  E2  workerA  A / —         yes       Oct 21 20:00 – Oct 22 00:00  Oct 21 22:00 – Oct 22 02:00 14400 (7200 + 7200)
 *  E3  workerA  A / Design    no        Oct 23 08:00 – 08:50         Oct 23 10:00 – 10:50         3000
 *  E4  workerB  B / Build     yes       Oct 24 22:30 – Oct 25 01:30  Oct 25 00:30 – 02:30 (CET)   10800
 *  E7  workerA  A / Design    yes       Oct 26 08:00 – 09:00         outside the week             3600
 *
 * Amounts (billable seconds × rate): E6 80.00 (1 h in range), E5 37.00, E1 200.00, E2 320.00,
 * E3 0, E4 270.00 → 907.00.
 */
export async function createReportDataset(s: Scenario) {
  const { workerA, workerB } = s.users;
  await prisma().projectMember.create({
    data: { projectId: s.projectA.id, userId: workerB.id, roleInProject: 'WORKER', hourlyRate: 60 },
  });
  const a = s.projectA.id;
  const design = s.taskA.id;
  const entry = (
    userId: string,
    projectId: string,
    startedAt: string,
    endedAt: string,
    extra: { taskId?: string; isBillable?: boolean; description?: string } = {},
  ) => insertEntry({ userId, projectId, startedAt, endedAt, ...extra });

  const e6 = await entry(workerA.id, a, '2026-10-18T21:00:00Z', '2026-10-18T23:00:00Z', {
    taskId: design,
    description: 'Late wireframes',
  });
  const e5 = await entry(workerB.id, a, '2026-10-19T05:53:00Z', '2026-10-19T06:30:00Z', {
    description: 'Review',
  });
  const e1 = await entry(workerA.id, a, '2026-10-20T07:00:00Z', '2026-10-20T09:30:00Z', {
    taskId: design,
    description: 'Mockups',
  });
  const e2 = await entry(workerA.id, a, '2026-10-21T20:00:00Z', '2026-10-22T00:00:00Z', {
    description: 'Release night',
  });
  const e3 = await entry(workerA.id, a, '2026-10-23T08:00:00Z', '2026-10-23T08:50:00Z', {
    taskId: design,
    isBillable: false,
    description: '=HYPERLINK("http://evil.test")',
  });
  const e4 = await entry(
    workerB.id,
    s.projectB.id,
    '2026-10-24T22:30:00Z',
    '2026-10-25T01:30:00Z',
    {
      taskId: s.taskB.id,
      description: 'Migration, "phase 2"',
    },
  );
  const e7 = await entry(workerA.id, a, '2026-10-26T08:00:00Z', '2026-10-26T09:00:00Z', {
    taskId: design,
  });
  return { e1, e2, e3, e4, e5, e6, e7 };
}

export const WEEK = { from: '2026-10-19', to: '2026-10-25' };
