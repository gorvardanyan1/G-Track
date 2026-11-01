import {
  addDays,
  reportPortions,
  startOfLocalDay,
  summarizeReport,
  type ReportPortion,
  type ReportQuery,
  type RoundingRule,
} from '@tempo/shared';
import { NotFoundError } from '../../errors/app-error.ts';
import type { Clock } from '../../lib/clock.ts';
import type { AuthContext } from '../auth/auth.types.ts';
import type { SettingsRepository } from '../settings/settings.repository.ts';
import { reportOptions } from './report-options.ts';
import { resolveReportScope } from './report-scope.ts';
import type { ReportEntryRow, ReportsRepository } from './reports.repository.ts';

interface Deps {
  reports: ReportsRepository;
  settings: SettingsRepository;
  clock: Clock;
}

export type ReportEntry = Omit<ReportEntryRow, 'endedAt'> & {
  endedAt: Date;
  rateCents: number | null;
};

export interface Report {
  from: string;
  to: string;
  /** The requesting user's timezone: days are split at their local midnight. */
  timezone: string;
  rounding: RoundingRule | null;
  showAmounts: boolean;
  orgName: string;
  generatedAt: Date;
  portions: ReportPortion<ReportEntry>[];
  summary: ReturnType<typeof summarizeReport>;
}

export function createReportsService({ reports, settings, clock }: Deps) {
  return {
    options: (auth: AuthContext) => reportOptions(reports, auth),

    async build(auth: AuthContext, query: ReportQuery): Promise<Report> {
      const viewer = await reports.findViewer(auth.userId);
      if (!viewer) throw new NotFoundError('User not found');
      const { filter, showAmounts } = await resolveReportScope(reports, auth, query);
      const org = await settings.get();

      const range = {
        start: startOfLocalDay(query.from, viewer.timezone),
        end: startOfLocalDay(addDays(query.to, 1), viewer.timezone),
      };
      const rows = await reports.findEntries({
        ...range,
        ...filter,
        ...(query.billable !== undefined && { billable: query.billable }),
      });

      // Each entry carries the rate from when it was tracked: later rate changes don't rewrite
      // past billing. Amounts are for admins and PMs only.
      const entries: ReportEntry[] = rows.flatMap((row) =>
        row.endedAt
          ? [
              {
                ...row,
                endedAt: row.endedAt,
                rateCents:
                  showAmounts && row.hourlyRate !== null
                    ? row.hourlyRate.mul(100).toNumber()
                    : null,
              },
            ]
          : [],
      );

      const rounding =
        query.round && org.roundingMinutes > 0
          ? { minutes: org.roundingMinutes, mode: org.roundingMode }
          : null;
      const portions = reportPortions(entries, { range, zone: viewer.timezone, rounding });
      return {
        from: query.from,
        to: query.to,
        timezone: viewer.timezone,
        rounding,
        showAmounts,
        orgName: org.name,
        generatedAt: clock(),
        portions,
        summary: summarizeReport(portions, query.from, query.to),
      };
    },
  };
}

export type ReportsService = ReturnType<typeof createReportsService>;
