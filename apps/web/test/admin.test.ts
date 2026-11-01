import { describe, expect, it } from 'vitest';
import type { OrgSettingsResponse } from '@tempo/shared';
import {
  auditActionGroups,
  auditActionLabel,
  auditDiff,
  formatAuditValue,
} from '../src/lib/audit-diff.ts';
import { optionalNumber } from '../src/lib/number.ts';
import { changedSettings, settingsErrors, toSettingsForm } from '../src/lib/settings-form.ts';

describe('audit before/after diff', () => {
  it('lists changed fields first, then added, removed and unchanged', () => {
    const rows = auditDiff(
      { name: 'Website', budgetHours: 100, color: '#5B5BF7', clientId: 'c1' },
      { name: 'Website', budgetHours: 150, color: '#5B5BF7', isBillable: true },
    );
    expect(rows.map((r) => [r.path, r.kind])).toEqual([
      ['budgetHours', 'changed'],
      ['isBillable', 'added'],
      ['clientId', 'removed'],
      ['name', 'same'],
      ['color', 'same'],
    ]);
    expect(rows[0]).toMatchObject({ before: 100, after: 150 });
  });

  it('flattens nested objects to dotted paths and treats arrays as values', () => {
    const rows = auditDiff(
      { rounding: { minutes: 15, mode: 'UP' }, tags: ['a'] },
      { rounding: { minutes: 15, mode: 'NEAREST' }, tags: ['a', 'b'] },
    );
    expect(rows.filter((r) => r.kind === 'changed').map((r) => r.path)).toEqual([
      'rounding.mode',
      'tags',
    ]);
  });

  it('handles a creation (no before), a deletion (no after) and no snapshot at all', () => {
    expect(auditDiff(null, { role: 'WORKER' })).toEqual([
      { path: 'role', before: undefined, after: 'WORKER', kind: 'added' },
    ]);
    expect(auditDiff({ description: 'x' }, null)[0]?.kind).toBe('removed');
    expect(auditDiff(null, null)).toEqual([]);
    expect(auditDiff('PM', 'WORKER')).toEqual([
      { path: 'value', before: 'PM', after: 'WORKER', kind: 'changed' },
    ]);
  });

  it('formats values and action names for people', () => {
    expect(formatAuditValue(null)).toBe('null');
    expect(formatAuditValue('')).toBe('""');
    expect(formatAuditValue(undefined)).toBe('—');
    expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
    expect(auditActionLabel('time_entry.updated')).toBe('Time entry updated');
    expect(auditActionGroups(['auth.logout', 'auth.login.failed', 'task.created'])).toEqual([
      { prefix: 'auth.', actions: ['auth.logout', 'auth.login.failed'] },
      { prefix: 'task.', actions: ['task.created'] },
    ]);
  });
});

describe('organization settings form', () => {
  const saved: OrgSettingsResponse = {
    name: 'TEMPO',
    defaultTimezone: 'Europe/Berlin',
    weekStartDay: 1,
    roundingMinutes: 0,
    roundingMode: 'NEAREST',
    maxTimerDurationSeconds: 43_200,
    timesheetApprovalEnabled: true,
    lockAfterDays: null,
    updatedAt: null,
    updatedBy: null,
  };

  it('sends only what changed, in api units', () => {
    const form = toSettingsForm(saved);
    expect(form).toMatchObject({ maxTimerHours: 12, lockEnabled: false, lockAfterDays: 30 });
    expect(changedSettings(saved, form)).toEqual({});
    expect(
      changedSettings(saved, {
        ...form,
        name: ' TEMPO GmbH ',
        maxTimerHours: 8.5,
        lockEnabled: true,
        lockAfterDays: 45,
      }),
    ).toEqual({ name: 'TEMPO GmbH', maxTimerDurationSeconds: 30_600, lockAfterDays: 45 });
    expect(
      changedSettings({ ...saved, lockAfterDays: 30 }, { ...form, lockEnabled: false }),
    ).toEqual({ lockAfterDays: null });
  });

  it('checks the same bounds as the api', () => {
    const form = toSettingsForm(saved);
    expect(settingsErrors(form)).toEqual({});
    expect(
      Object.keys(
        settingsErrors({
          ...form,
          name: ' ',
          maxTimerHours: 25,
          lockEnabled: true,
          lockAfterDays: 0.5,
        }),
      ),
    ).toEqual(['name', 'maxTimerHours', 'lockAfterDays']);
    expect(settingsErrors({ ...form, maxTimerHours: 0.01 })).toHaveProperty('maxTimerHours');
  });
});

describe('optional number fields', () => {
  it('reads what Vue’s v-model gives for number inputs', () => {
    expect(optionalNumber('')).toBeNull();
    expect(optionalNumber('  ')).toBeNull();
    expect(optionalNumber(120)).toBe(120);
    expect(optionalNumber('80.5')).toBe(80.5);
    expect(optionalNumber('abc')).toBeNaN();
  });
});
