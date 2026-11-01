import type { WeekStartDay } from '@tempo/shared';
import type { PrismaClient } from '../../db/prisma.ts';
import type { RoundingMode } from '../../generated/prisma/client.ts';

export interface OrgSettings {
  name: string;
  defaultTimezone: string;
  weekStartDay: WeekStartDay;
  roundingMinutes: number;
  roundingMode: RoundingMode;
  maxTimerDurationSeconds: number;
  timesheetApprovalEnabled: boolean;
  lockAfterDays: number | null;
  updatedAt: Date | null;
  updatedBy: { id: string; name: string } | null;
}

/** What the rest of the api needs to know from the settings. */
export interface OrgPolicy {
  timezone: string;
  weekStartDay: WeekStartDay;
  maxTimerDurationSeconds: number;
  lockAfterDays: number | null;
  timesheetApprovalEnabled: boolean;
  rounding: { minutes: number; mode: RoundingMode };
}

/** Used until a Super Admin saves organization settings. */
export const DEFAULT_ORG_SETTINGS: OrgSettings = {
  name: 'TEMPO',
  defaultTimezone: 'UTC',
  weekStartDay: 1,
  roundingMinutes: 0,
  roundingMode: 'NEAREST',
  maxTimerDurationSeconds: 12 * 3600,
  timesheetApprovalEnabled: true,
  lockAfterDays: null,
  updatedAt: null,
  updatedBy: null,
};

export type OrgSettingsChanges = Partial<
  Omit<OrgSettings, 'updatedAt' | 'updatedBy' | 'weekStartDay'> & { weekStartDay: number }
>;

export const policyOf = (s: OrgSettings): OrgPolicy => ({
  timezone: s.defaultTimezone,
  weekStartDay: s.weekStartDay,
  maxTimerDurationSeconds: s.maxTimerDurationSeconds,
  lockAfterDays: s.lockAfterDays,
  timesheetApprovalEnabled: s.timesheetApprovalEnabled,
  rounding: { minutes: s.roundingMinutes, mode: s.roundingMode },
});

const include = { updatedBy: { select: { id: true, name: true } } } as const;

export function createSettingsRepository(prisma: PrismaClient) {
  async function get(): Promise<OrgSettings> {
    const row = await prisma.orgSettings.findUnique({ where: { id: 1 }, include });
    if (!row) return DEFAULT_ORG_SETTINGS;
    return {
      name: row.name,
      defaultTimezone: row.defaultTimezone,
      weekStartDay: row.weekStartDay as WeekStartDay,
      roundingMinutes: row.roundingMinutes,
      roundingMode: row.roundingMode,
      maxTimerDurationSeconds: row.maxTimerDurationSeconds,
      timesheetApprovalEnabled: row.timesheetApprovalEnabled,
      lockAfterDays: row.lockAfterDays,
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
    };
  }

  return {
    get,
    getPolicy: async () => policyOf(await get()),

    /** Creates the single row from the defaults on first save. */
    async save(
      changes: OrgSettingsChanges,
      updatedById: string,
      updatedAt: Date,
    ): Promise<OrgSettings> {
      const { updatedAt: _a, updatedBy: _b, ...defaults } = DEFAULT_ORG_SETTINGS;
      await prisma.orgSettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...defaults, ...changes, updatedById, updatedAt },
        update: { ...changes, updatedById, updatedAt },
      });
      return get();
    },
  };
}

export type SettingsRepository = ReturnType<typeof createSettingsRepository>;
