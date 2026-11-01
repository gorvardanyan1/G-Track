import { describe, expect, it } from 'vitest';
import {
  listAuditLogsQuerySchema,
  rejectTimesheetRequestSchema,
  reportQuerySchema,
  updateOrgSettingsRequestSchema,
} from '../src/index.ts';

const A = '0190e5b2-0000-7000-8000-00000000000a';
const B = '0190e5b2-0000-7000-8000-00000000000b';

describe('reportQuerySchema', () => {
  it('accepts repeated and comma-separated ids and query booleans', () => {
    const q = reportQuerySchema.parse({
      from: '2026-10-01',
      to: '2026-10-31',
      projectId: [A, B],
      userId: `${A}, ${B}`,
      billable: 'false',
    });
    expect(q).toMatchObject({ projectId: [A, B], userId: [A, B], billable: false, round: false });
    expect(
      reportQuerySchema.parse({ from: '2026-10-01', to: '2026-10-01', taskId: A }).taskId,
    ).toEqual([A]);
  });

  it('rejects bad ids, reversed and too long ranges', () => {
    const base = { from: '2026-10-01', to: '2026-10-31' };
    expect(reportQuerySchema.safeParse({ ...base, projectId: 'x' }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ ...base, round: 'yes' }).success).toBe(false);
    expect(reportQuerySchema.safeParse({ from: '2026-10-31', to: '2026-10-01' }).success).toBe(
      false,
    );
    // 366 days is the maximum (a leap year); 367 is too many.
    expect(reportQuerySchema.safeParse({ from: '2028-01-01', to: '2028-12-31' }).success).toBe(
      true,
    );
    expect(reportQuerySchema.safeParse({ from: '2028-01-01', to: '2029-01-01' }).success).toBe(
      false,
    );
  });
});

describe('updateOrgSettingsRequestSchema', () => {
  it('strips unknown keys and requires at least one change', () => {
    expect(updateOrgSettingsRequestSchema.parse({ name: ' Acme ', id: 2 })).toEqual({
      name: 'Acme',
    });
    expect(updateOrgSettingsRequestSchema.safeParse({}).success).toBe(false);
    expect(updateOrgSettingsRequestSchema.parse({ lockAfterDays: null })).toEqual({
      lockAfterDays: null,
    });
  });

  it('only accepts real IANA zones', () => {
    expect(
      updateOrgSettingsRequestSchema.safeParse({ defaultTimezone: 'Asia/Yerevan' }).success,
    ).toBe(true);
    expect(updateOrgSettingsRequestSchema.safeParse({ defaultTimezone: 'Etc/GMT+4' }).success).toBe(
      false,
    );
  });
});

describe('timesheet and audit schemas', () => {
  it('a rejection needs a non-blank comment', () => {
    expect(rejectTimesheetRequestSchema.safeParse({ comment: '  ' }).success).toBe(false);
    expect(rejectTimesheetRequestSchema.parse({ comment: ' Fix Tuesday ' }).comment).toBe(
      'Fix Tuesday',
    );
  });

  it('audit action filters are plain names or prefixes', () => {
    expect(
      listAuditLogsQuerySchema.parse({ action: 'time_entry.,auth.login.failed' }).action,
    ).toEqual(['time_entry.', 'auth.login.failed']);
    expect(listAuditLogsQuerySchema.safeParse({ action: "x' OR 1=1" }).success).toBe(false);
  });
});
