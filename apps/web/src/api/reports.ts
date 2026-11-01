import {
  reportEntriesResponseSchema,
  reportOptionsResponseSchema,
  reportResponseSchema,
} from '@tempo/shared';
import { http } from './client.ts';

export interface ReportParams {
  from: string;
  to: string;
  projectId?: string[];
  taskId?: string[];
  userId?: string[];
  clientId?: string[];
  billable?: boolean;
  round?: boolean;
}

const query = (p: ReportParams) => ({
  from: p.from,
  to: p.to,
  projectId: p.projectId,
  taskId: p.taskId,
  userId: p.userId,
  clientId: p.clientId,
  billable: p.billable === undefined ? undefined : String(p.billable),
  round: p.round ? 'true' : undefined,
});

export const reportsApi = {
  summary: (p: ReportParams) => http.request('/reports', reportResponseSchema, { query: query(p) }),
  /** The report's rows (one per entry per local day), newest first. */
  entries: (p: ReportParams, page: number, pageSize = 25) =>
    http.request('/reports/entries', reportEntriesResponseSchema, {
      query: { ...query(p), page: String(page), pageSize: String(pageSize) },
    }),
  /** What the filters may offer: exactly the caller's reporting scope. */
  options: () => http.request('/reports/options', reportOptionsResponseSchema),
  export: (p: ReportParams, format: 'csv' | 'pdf') =>
    http.download(`/reports/export.${format}`, { query: query(p) }),
};
