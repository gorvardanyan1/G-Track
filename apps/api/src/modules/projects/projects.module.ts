import type { RequestHandler, Router } from 'express';
import type { PrismaClient } from '../../db/prisma.ts';
import type { Clock } from '../../lib/clock.ts';
import type { EventBus } from '../../lib/event-bus.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { createSettingsRepository } from '../settings/settings.repository.ts';
import { createMembersService } from './members.service.ts';
import { createProjectUsageRepository } from './project-usage.repository.ts';
import { createProjectUsageService } from './project-usage.service.ts';
import { createProjectsController } from './projects.controller.ts';
import { createProjectsRepository } from './projects.repository.ts';
import { createProjectsRouter } from './projects.routes.ts';
import { createProjectsService } from './projects.service.ts';
import { createTasksService } from './tasks.service.ts';

export function createProjectsModule(deps: {
  prisma: PrismaClient;
  audit: AuditService;
  clock: Clock;
  authenticate: RequestHandler;
  events: EventBus;
}): Router {
  const projects = createProjectsRepository(deps.prisma);
  const controller = createProjectsController({
    projects: createProjectsService({ projects, audit: deps.audit, clock: deps.clock }),
    members: createMembersService({ projects, audit: deps.audit, events: deps.events }),
    tasks: createTasksService({ projects, audit: deps.audit }),
    usage: createProjectUsageService({
      projects,
      usage: createProjectUsageRepository(deps.prisma),
      settings: createSettingsRepository(deps.prisma),
      clock: deps.clock,
    }),
  });
  return createProjectsRouter(controller, deps.authenticate);
}
