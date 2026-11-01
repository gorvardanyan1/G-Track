import { Router } from 'express';
import { healthRouter } from './modules/health/health.routes.ts';

export interface ApiModules {
  auth: Router;
  users: Router;
  clients: Router;
  projects: Router;
  timer: Router;
  timeEntries: Router;
  timesheets: Router;
  reports: Router;
  settings: Router;
  auditLogs: Router;
}

export function createApiRouter(modules: ApiModules): Router {
  const router = Router();
  router.use('/health', healthRouter);
  router.use('/auth', modules.auth);
  router.use('/users', modules.users);
  router.use('/clients', modules.clients);
  router.use('/projects', modules.projects);
  router.use('/timer', modules.timer);
  router.use('/time-entries', modules.timeEntries);
  router.use('/timesheets', modules.timesheets);
  router.use('/reports', modules.reports);
  router.use('/settings', modules.settings);
  router.use('/audit-logs', modules.auditLogs);
  return router;
}
