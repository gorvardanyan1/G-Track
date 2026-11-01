import { truncateToSecond, type StartTimerRequest } from '@tempo/shared';
import { ConflictError, NotFoundError } from '../../errors/app-error.ts';
import type { TimeEntrySource } from '../../generated/prisma/client.ts';
import type { Clock } from '../../lib/clock.ts';
import type { EventBus } from '../../lib/event-bus.ts';
import type { AuthContext } from '../auth/auth.types.ts';
import { isOverlapViolation, type EntryPolicy } from '../time-entries/entry-policy.ts';
import type {
  EntryWithRefs,
  TimeEntriesRepository,
} from '../time-entries/time-entries.repository.ts';

interface Deps {
  entries: TimeEntriesRepository;
  policy: EntryPolicy;
  clock: Clock;
  events: EventBus;
}

/**
 * When a running timer stops at `now`: never before 1 s after its start (the check constraint
 * requires end > start), and never longer than the org maximum — then it counts as auto-stopped.
 */
export function stopInstant(
  entry: { startedAt: Date; source: TimeEntrySource },
  now: Date,
  maxSeconds: number,
) {
  const start = entry.startedAt.getTime();
  const end = Math.max(now.getTime(), start + 1000);
  if (end - start > maxSeconds * 1000) {
    return { endedAt: new Date(start + maxSeconds * 1000), source: 'AUTO_STOPPED' as const };
  }
  return { endedAt: new Date(end), source: entry.source };
}

/** The running timer. Start and stop always use the server's clock, never the client's. */
export function createTimerService({ entries, policy, clock, events }: Deps) {
  return {
    current: (auth: AuthContext) => entries.findRunning(auth.userId),

    /**
     * Stops any running timer and starts a new one in one transaction. Concurrent starts for the
     * same user are serialized by a row lock on the user, so exactly one timer ends up running.
     */
    async start(auth: AuthContext, input: StartTimerRequest): Promise<EntryWithRefs> {
      const user = await entries.findUser(auth.userId);
      if (!user) throw new NotFoundError('User not found');
      const project = await policy.assertCanTrack(user.id, input.projectId, input.taskId);
      const { maxTimerDurationSeconds } = await policy.policy();

      let result;
      try {
        result = await entries.transaction(async (tx) => {
          await entries.lockUser(tx, user.id);
          const now = truncateToSecond(clock());
          await policy.assertEditable(user, now, null);

          const running = await entries.findRunning(user.id, tx);
          const replaced = running !== null && running.startedAt >= now;
          if (running && replaced) {
            // Started within this same second: a zero-length timer, replaced rather than kept.
            await entries.delete(running.id, tx);
          } else if (running) {
            await entries.update(
              running.id,
              stopInstant(running, now, maxTimerDurationSeconds),
              tx,
            );
          }
          const entry = await entries.create(
            user.id,
            {
              projectId: input.projectId,
              taskId: input.taskId,
              description: input.description,
              isBillable: input.isBillable ?? project.isBillable,
              startedAt: now,
              endedAt: null,
            },
            'TIMER',
            tx,
          );
          return { entry, previous: running && { ...running, replaced } };
        });
      } catch (err) {
        if (isOverlapViolation(err)) {
          const conflict = await entries.findOverlap(user.id, truncateToSecond(clock()), null);
          if (conflict) throw policy.overlapError(conflict, user.timezone);
          throw new ConflictError('Another request changed the timer at the same time; try again');
        }
        throw err;
      }

      const { entry, previous } = result;
      if (previous) {
        // Live activity comes once, from the start event below (it covers both projects).
        const projectIds: string[] = [];
        events.publish(
          previous.replaced
            ? { type: 'entry.deleted', userId: user.id, entryId: previous.id, projectIds }
            : {
                type: 'entry.saved',
                userId: user.id,
                entryId: previous.id,
                action: 'timer_stopped',
                projectIds,
              },
        );
      }
      events.publish({
        type: 'entry.saved',
        userId: user.id,
        entryId: entry.id,
        action: 'timer_started',
        projectIds: [...new Set([entry.projectId, ...(previous ? [previous.projectId] : [])])],
      });
      return entry;
    },

    async stop(auth: AuthContext): Promise<EntryWithRefs> {
      const { maxTimerDurationSeconds } = await policy.policy();
      const entry = await entries.transaction(async (tx) => {
        await entries.lockUser(tx, auth.userId);
        const running = await entries.findRunning(auth.userId, tx);
        if (!running) throw new NotFoundError('No timer is running');
        return entries.update(
          running.id,
          stopInstant(running, truncateToSecond(clock()), maxTimerDurationSeconds),
          tx,
        );
      });
      events.publish({
        type: 'entry.saved',
        userId: auth.userId,
        entryId: entry.id,
        action: entry.source === 'AUTO_STOPPED' ? 'auto_stopped' : 'timer_stopped',
        projectIds: [entry.projectId],
      });
      return entry;
    },
  };
}

export type TimerService = ReturnType<typeof createTimerService>;
