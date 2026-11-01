import type { RequestHandler } from 'express';
import type {
  ApproveTimesheetRequest,
  ListTimesheetsQuery,
  Page,
  RejectTimesheetRequest,
  SubmitTimesheetRequest,
  TimesheetSummary,
  TimesheetWeekQuery,
} from '@tempo/shared';
import { requestContext } from '../../lib/request-context.ts';
import { validatedBody, validatedParams, validatedQuery } from '../../middleware/validate.ts';
import { requireAuth } from '../auth/auth.http.ts';
import { toTimesheetResponse, toTimesheetSummary } from './timesheets.mappers.ts';
import type { TimesheetsService } from './timesheets.service.ts';

type IdParams = { id: string };

export function createTimesheetsController(timesheets: TimesheetsService) {
  const id = (req: Parameters<RequestHandler>[0]) => validatedParams<IdParams>(req).id;

  const list: RequestHandler = async (req, res) => {
    const query = validatedQuery<ListTimesheetsQuery>(req);
    const { rows, total } = await timesheets.list(requireAuth(req), query);
    const body: Page<TimesheetSummary> = {
      items: rows.map((r) => toTimesheetSummary(r.sheet, r.totalSeconds)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
    res.json(body);
  };

  const mine: RequestHandler = async (req, res) => {
    const { week } = validatedQuery<TimesheetWeekQuery>(req);
    res.json(toTimesheetResponse(await timesheets.mine(requireAuth(req), week)));
  };

  const get: RequestHandler = async (req, res) => {
    res.json(toTimesheetResponse(await timesheets.get(requireAuth(req), id(req))));
  };

  const submit: RequestHandler = async (req, res) => {
    const { week } = validatedBody<SubmitTimesheetRequest>(req);
    res.json(
      toTimesheetResponse(await timesheets.submit(requireAuth(req), week, requestContext(req))),
    );
  };

  const approve: RequestHandler = async (req, res) => {
    const { comment } = validatedBody<ApproveTimesheetRequest>(req);
    const detail = await timesheets.approve(
      requireAuth(req),
      id(req),
      comment || null,
      requestContext(req),
    );
    res.json(toTimesheetResponse(detail));
  };

  const reject: RequestHandler = async (req, res) => {
    const { comment } = validatedBody<RejectTimesheetRequest>(req);
    const detail = await timesheets.reject(requireAuth(req), id(req), comment, requestContext(req));
    res.json(toTimesheetResponse(detail));
  };

  return { list, mine, get, submit, approve, reject };
}
