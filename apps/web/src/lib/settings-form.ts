import type { OrgSettingsResponse, RoundingMode, UpdateOrgSettingsRequest } from '@tempo/shared';

/** The settings as the form edits them (hours instead of seconds, lock as on/off + days). */
export interface SettingsForm {
  name: string;
  defaultTimezone: string;
  weekStartDay: number;
  roundingMinutes: number;
  roundingMode: RoundingMode;
  maxTimerHours: number;
  timesheetApprovalEnabled: boolean;
  lockEnabled: boolean;
  lockAfterDays: number;
}

export function toSettingsForm(s: OrgSettingsResponse): SettingsForm {
  return {
    name: s.name,
    defaultTimezone: s.defaultTimezone,
    weekStartDay: s.weekStartDay,
    roundingMinutes: s.roundingMinutes,
    roundingMode: s.roundingMode,
    maxTimerHours: s.maxTimerDurationSeconds / 3600,
    timesheetApprovalEnabled: s.timesheetApprovalEnabled,
    lockEnabled: s.lockAfterDays !== null,
    lockAfterDays: s.lockAfterDays ?? 30,
  };
}

function toRequest(f: SettingsForm): Required<UpdateOrgSettingsRequest> {
  return {
    name: f.name.trim(),
    defaultTimezone: f.defaultTimezone,
    weekStartDay: f.weekStartDay,
    roundingMinutes: f.roundingMinutes,
    roundingMode: f.roundingMode,
    maxTimerDurationSeconds: Math.round(f.maxTimerHours * 3600),
    timesheetApprovalEnabled: f.timesheetApprovalEnabled,
    lockAfterDays: f.lockEnabled ? Math.round(f.lockAfterDays) : null,
  };
}

/** Only the fields that differ from the saved settings, so the audit log shows real changes. */
export function changedSettings(
  saved: OrgSettingsResponse,
  form: SettingsForm,
): UpdateOrgSettingsRequest {
  const before = toRequest(toSettingsForm(saved));
  const after = toRequest(form);
  return Object.fromEntries(
    (Object.keys(after) as (keyof typeof after)[])
      .filter((key) => before[key] !== after[key])
      .map((key) => [key, after[key]]),
  );
}

/** Field errors mirroring the api's bounds; empty when valid. */
export function settingsErrors(f: SettingsForm): Partial<Record<keyof SettingsForm, string>> {
  const errors: Partial<Record<keyof SettingsForm, string>> = {};
  if (!f.name.trim()) errors.name = 'Give the organization a name';
  if (!(f.maxTimerHours * 3600 >= 60 && f.maxTimerHours <= 24))
    errors.maxTimerHours = 'Between 1 minute and 24 hours';
  if (
    f.lockEnabled &&
    !(Number.isInteger(f.lockAfterDays) && f.lockAfterDays >= 1 && f.lockAfterDays <= 3650)
  )
    errors.lockAfterDays = 'A whole number of days, 1 to 3650';
  return errors;
}
