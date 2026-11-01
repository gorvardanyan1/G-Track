import type { RequestHandler } from 'express';
import type { ReportEntriesQuery, ReportQuery } from '@tempo/shared';
import { validatedQuery } from '../../middleware/validate.ts';
import { requireAuth } from '../auth/auth.http.ts';
import { reportCsv } from './report-csv.ts';
import { reportPdf } from './report-pdf.ts';
import { toReportEntriesResponse, toReportResponse } from './reports.mappers.ts';
import type { ReportsService } from './reports.service.ts';

const filename = (q: ReportQuery, ext: string) => `tempo-report-${q.from}_${q.to}.${ext}`;

export function createReportsController(reports: ReportsService) {
  const build = (req: Parameters<RequestHandler>[0]) =>
    reports.build(requireAuth(req), validatedQuery<ReportQuery>(req));

  const summary: RequestHandler = async (req, res) => {
    res.json(toReportResponse(await build(req)));
  };

  const entries: RequestHandler = async (req, res) => {
    const query = validatedQuery<ReportEntriesQuery>(req);
    res.json(toReportEntriesResponse(await reports.build(requireAuth(req), query), query));
  };

  const options: RequestHandler = async (req, res) => {
    res.json(await reports.options(requireAuth(req)));
  };

  const csv: RequestHandler = async (req, res) => {
    const report = await build(req);
    res
      .type('text/csv; charset=utf-8')
      .attachment(filename(validatedQuery<ReportQuery>(req), 'csv'))
      .send(reportCsv(report));
  };

  const pdf: RequestHandler = async (req, res) => {
    const report = await build(req);
    res
      .type('application/pdf')
      .attachment(filename(validatedQuery<ReportQuery>(req), 'pdf'))
      .send(reportPdf(report));
  };

  return { summary, entries, options, csv, pdf };
}
