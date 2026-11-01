import type { RequestHandler } from 'express';
import type { StartTimerRequest, TimerResponse } from '@tempo/shared';
import type { Clock } from '../../lib/clock.ts';
import { validatedBody } from '../../middleware/validate.ts';
import { requireAuth } from '../auth/auth.http.ts';
import { toTimeEntryResponse } from '../time-entries/time-entries.mappers.ts';
import type { EntryWithRefs } from '../time-entries/time-entries.repository.ts';
import type { TimeEntriesService } from '../time-entries/time-entries.service.ts';
import type { TimerService } from './timer.service.ts';

export function createTimerController(
  timer: TimerService,
  entries: TimeEntriesService,
  clock: Clock,
) {
  const respond = async (
    req: Parameters<RequestHandler>[0],
    entry: EntryWithRefs | null,
  ): Promise<TimerResponse> => ({
    entry: entry && toTimeEntryResponse(entry, await entries.editable(requireAuth(req), entry)),
    serverTime: clock().toISOString(),
  });

  const current: RequestHandler = async (req, res) => {
    res.json(await respond(req, await timer.current(requireAuth(req))));
  };

  const start: RequestHandler = async (req, res) => {
    const entry = await timer.start(requireAuth(req), validatedBody<StartTimerRequest>(req));
    res.status(201).json(await respond(req, entry));
  };

  const stop: RequestHandler = async (req, res) => {
    res.json(await respond(req, await timer.stop(requireAuth(req))));
  };

  return { current, start, stop };
}
