import type { Clock } from '../../lib/clock.ts';
import type { RequestContext } from '../../lib/request-context.ts';
import type { AuditAction } from './audit-actions.ts';
import type { AuditRepository } from './audit.repository.ts';

export interface AuditEvent {
  actorId?: string | null;
  targetType?: string;
  targetId?: string | null;
  /** Never put passwords, tokens or secrets in before/after. */
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/** Rows are stamped with the server clock (injectable, like every other server timestamp). */
export function createAuditService(repository: AuditRepository, clock: Clock) {
  return {
    async record(action: AuditAction, event: AuditEvent, context: RequestContext): Promise<void> {
      await repository.insert({
        action,
        actorId: event.actorId ?? null,
        targetType: event.targetType ?? null,
        targetId: event.targetId ?? null,
        before: event.before,
        after: event.after,
        ip: context.ip,
        userAgent: context.userAgent,
        requestId: context.requestId,
        createdAt: clock(),
      });
    },
  };
}

export type AuditService = ReturnType<typeof createAuditService>;
