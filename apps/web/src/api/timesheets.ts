import {
  pageSchema,
  timesheetResponseSchema,
  timesheetSummarySchema,
  type TimesheetStatus,
} from '@tempo/shared';
import { http } from './client.ts';

export interface TimesheetListParams {
  status?: TimesheetStatus;
  userId?: string;
  /** Only timesheets the caller may review. */
  reviewable?: boolean;
  page?: number;
  pageSize?: number;
}

export const timesheetsApi = {
  /** The caller's week containing `date`. */
  mine: (date: string) =>
    http.request('/timesheets/me', timesheetResponseSchema, { query: { week: date } }),
  submit: (date: string) =>
    http.request('/timesheets/submit', timesheetResponseSchema, {
      method: 'POST',
      body: { week: date },
    }),

  list: (p: TimesheetListParams = {}) =>
    http.request('/timesheets', pageSchema(timesheetSummarySchema), {
      query: {
        status: p.status,
        userId: p.userId,
        reviewable: p.reviewable ? 'true' : undefined,
        page: p.page ? String(p.page) : undefined,
        pageSize: p.pageSize ? String(p.pageSize) : undefined,
      },
    }),
  get: (id: string) => http.request(`/timesheets/${id}`, timesheetResponseSchema),
  approve: (id: string, comment?: string) =>
    http.request(`/timesheets/${id}/approve`, timesheetResponseSchema, {
      method: 'POST',
      body: comment ? { comment } : {},
    }),
  reject: (id: string, comment: string) =>
    http.request(`/timesheets/${id}/reject`, timesheetResponseSchema, {
      method: 'POST',
      body: { comment },
    }),
};
