import type { RequestHandler } from 'express';
import type {
  CreateTimeEntryRequest,
  DuplicateTimeEntryRequest,
  ListTimeEntriesQuery,
  UpdateTimeEntryRequest,
} from '@tempo/shared';
import { requestContext } from '../../lib/request-context.ts';
import { validatedBody, validatedParams, validatedQuery } from '../../middleware/validate.ts';
import { requireAuth } from '../auth/auth.http.ts';
import { toTimeEntryResponse } from './time-entries.mappers.ts';
import type { EntryWithRefs } from './time-entries.repository.ts';
import type { TimeEntriesService } from './time-entries.service.ts';

type IdParams = { id: string };

export function createTimeEntriesController(entries: TimeEntriesService) {
  const id = (req: Parameters<RequestHandler>[0]) => validatedParams<IdParams>(req).id;
  const withEditable = async (req: Parameters<RequestHandler>[0], entry: EntryWithRefs) =>
    toTimeEntryResponse(entry, await entries.editable(requireAuth(req), entry));

  const list: RequestHandler = async (req, res) => {
    const rows = await entries.list(requireAuth(req), validatedQuery<ListTimeEntriesQuery>(req));
    res.json(rows.map(({ entry, editable }) => toTimeEntryResponse(entry, editable)));
  };

  const get: RequestHandler = async (req, res) => {
    res.json(await withEditable(req, await entries.get(requireAuth(req), id(req))));
  };

  const create: RequestHandler = async (req, res) => {
    const entry = await entries.createManual(
      requireAuth(req),
      validatedBody<CreateTimeEntryRequest>(req),
      requestContext(req),
    );
    res.status(201).json(await withEditable(req, entry));
  };

  const update: RequestHandler = async (req, res) => {
    const entry = await entries.update(
      requireAuth(req),
      id(req),
      validatedBody<UpdateTimeEntryRequest>(req),
      requestContext(req),
    );
    res.json(await withEditable(req, entry));
  };

  const remove: RequestHandler = async (req, res) => {
    await entries.remove(requireAuth(req), id(req), requestContext(req));
    res.status(204).end();
  };

  const duplicate: RequestHandler = async (req, res) => {
    const { date } = validatedBody<DuplicateTimeEntryRequest>(req);
    const entry = await entries.duplicate(requireAuth(req), id(req), date, requestContext(req));
    res.status(201).json(await withEditable(req, entry));
  };

  return { list, get, create, update, remove, duplicate };
}
