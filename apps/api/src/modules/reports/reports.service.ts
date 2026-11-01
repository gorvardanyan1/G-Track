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

      const rates = new Map<string, number>();
      if (showAmounts) {
        for (const r of await reports.rates([...new Set(rows.map((e) => e.projectId))])) {
          if (r.hourlyRate)
            rates.set(`${r.projectId}:${r.userId}`, r.hourlyRate.mul(100).toNumber());
        }
      }
      const entries: ReportEntry[] = rows.flatMap((row) =>
        row.endedAt
          ? [
              {
                ...row,
                endedAt: row.endedAt,
                rateCents: rates.get(`${row.projectId}:${row.userId}`) ?? null,
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
