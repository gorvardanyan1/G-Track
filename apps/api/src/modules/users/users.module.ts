import type { RequestHandler, Router } from 'express';
import type { PrismaClient } from '../../db/prisma.ts';
import type { Clock } from '../../lib/clock.ts';
import type { EventBus } from '../../lib/event-bus.ts';
import type { RateLimiter } from '../../middleware/rate-limit.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { SessionService } from '../auth/session.service.ts';
import { createUsersController } from './users.controller.ts';
import { createUsersRepository } from './users.repository.ts';
import { createUsersRouter } from './users.routes.ts';
import { createUsersService } from './users.service.ts';

export function createUsersModule(deps: {
  prisma: PrismaClient;
  audit: AuditService;
  clock: Clock;
  sessions: SessionService;
  authenticate: RequestHandler;
  createInvite: RequestHandler;
  rateLimit: RateLimiter;
  events: EventBus;
}): Router {
  const service = createUsersService({
    users: createUsersRepository(deps.prisma),
    sessions: deps.sessions,
    audit: deps.audit,
    clock: deps.clock,
    events: deps.events,
  });
  return createUsersRouter({
    controller: createUsersController(service),
    createInvite: deps.createInvite,
    authenticate: deps.authenticate,
    rateLimit: deps.rateLimit,
  });
}
