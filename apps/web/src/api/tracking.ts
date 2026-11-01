import {
  timeEntryResponseSchema,
  timerResponseSchema,
  type CreateTimeEntryRequest,
  type StartTimerRequest,
  type UpdateTimeEntryRequest,
} from '@tempo/shared';
import { z } from 'zod';
import { http } from './client.ts';

export const trackingApi = {
  currentTimer: () => http.request('/timer', timerResponseSchema),
  startTimer: (body: StartTimerRequest) =>
    http.request('/timer/start', timerResponseSchema, { method: 'POST', body }),
  stopTimer: () => http.request('/timer/stop', timerResponseSchema, { method: 'POST' }),

  /** Inclusive local dates in the user's timezone. */
  listEntries: (from: string, to: string) =>
    http.request('/time-entries', z.array(timeEntryResponseSchema), { query: { from, to } }),
  createEntry: (body: CreateTimeEntryRequest) =>
    http.request('/time-entries', timeEntryResponseSchema, { method: 'POST', body }),
  updateEntry: (id: string, body: UpdateTimeEntryRequest) =>
    http.request(`/time-entries/${id}`, timeEntryResponseSchema, { method: 'PATCH', body }),
  deleteEntry: (id: string) => http.send(`/time-entries/${id}`, { method: 'DELETE' }),
  duplicateEntry: (id: string, date?: string) =>
    http.request(`/time-entries/${id}/duplicate`, timeEntryResponseSchema, {
      method: 'POST',
      body: date ? { date } : {},
    }),
};
