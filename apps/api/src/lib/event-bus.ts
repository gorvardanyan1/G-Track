import type { Logger } from 'pino';
import type { EntrySavedAction } from '@tempo/shared';

/**
 * Domain facts published by services after their write committed. Subscribers (the realtime
 * module) turn them into socket events; services never know about sockets.
 */
export type DomainEvent =
  | {
      type: 'entry.saved';
      userId: string;
      entryId: string;
      action: EntrySavedAction;
      /** Every project the change touched (old and new), for live activity; [] = none. */
      projectIds: string[];
    }
  | { type: 'entry.deleted'; userId: string; entryId: string; projectIds: string[] }
  | { type: 'timesheet.changed'; userId: string; timesheetId: string }
  /** Role or project membership changed: recompute which rooms the user's sockets are in. */
  | { type: 'access.changed'; userId: string }
  /** Sessions ended: one session family, or all of a user's sessions (sessionId omitted). */
  | { type: 'sessions.revoked'; userId: string; sessionId?: string };

export type DomainEventHandler = (event: DomainEvent) => void | Promise<void>;

export interface EventBus {
  /** Fire and forget: a failing subscriber is logged and never fails the request. */
  publish(event: DomainEvent): void;
  subscribe(handler: DomainEventHandler): () => void;
}

export function createEventBus(logger?: Logger): EventBus {
  const handlers = new Set<DomainEventHandler>();
  return {
    publish(event) {
      for (const handler of handlers) {
        Promise.resolve()
          .then(() => handler(event))
          .catch((err: unknown) =>
            logger?.error({ err, event: event.type }, 'event handler failed'),
          );
      }
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => handlers.delete(handler);
    },
  };
}
