import type { RequestHandler, Router } from 'express';
import type { PrismaClient } from '../../db/prisma.ts';
import type { Clock } from '../../lib/clock.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { createClientsController } from './clients.controller.ts';
import { createClientsRepository } from './clients.repository.ts';
import { createClientsRouter } from './clients.routes.ts';
import { createClientsService } from './clients.service.ts';

export function createClientsModule(deps: {
  prisma: PrismaClient;
  audit: AuditService;
  clock: Clock;
  authenticate: RequestHandler;
}): Router {
  const service = createClientsService({
    clients: createClientsRepository(deps.prisma),
    audit: deps.audit,
    clock: deps.clock,
  });
  return createClientsRouter(createClientsController(service), deps.authenticate);
}
