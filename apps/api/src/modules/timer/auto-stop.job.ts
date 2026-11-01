import type { Logger } from 'pino';
import type { Clock } from '../../lib/clock.ts';
import type { EventBus } from '../../lib/event-bus.ts';
import { AuditAction } from '../audit/audit-actions.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { SettingsRepository } from '../settings/settings.repository.ts';
import type { TimeEntriesRepository } from '../time-entries/time-entries.repository.ts';

const SYSTEM_CONTEXT = { ip: null, userAgent: null, requestId: null };

interface Deps {
  entries: TimeEntriesRepository;
  settings: SettingsRepository;
  audit: AuditService;
  clock: Clock;
  logger: Logger;
  events: EventBus;
}

/** Stops timers that ran longer than the org maximum (default 12 h) and flags them. */
export function createAutoStopJob({ entries, settings, audit, clock, logger, events }: Deps) {
  async function run(): Promise<number> {
    const { maxTimerDurationSeconds } = await settings.getPolicy();
    const stopped = await entries.autoStop(clock(), maxTimerDurationSeconds);
    for (const entry of stopped) {
      await audit.record(
        AuditAction.TIME_ENTRY_AUTO_STOPPED,
        {
          actorId: null,
          targetType: 'time_entry',
          targetId: entry.id,
          after: {
            userId: entry.user_id,
            endedAt: entry.ended_at.toISOString(),
            maxTimerDurationSeconds,
          },
        },
        SYSTEM_CONTEXT,
      );
      events.publish({
        type: 'entry.saved',
        userId: entry.user_id,
        entryId: entry.id,
        action: 'auto_stopped',
        projectIds: [entry.project_id],
      });
    }
    if (stopped.length > 0)
      logger.info({ count: stopped.length }, 'auto-stopped long-running timers');
    return stopped.length;
  }

  return {
    run,
    /** Runs every `intervalMs`; overlapping runs are skipped. Returns a stop function. */
    schedule(intervalMs = 60_000): () => void {
      let busy = false;
      const timer = setInterval(() => {
        if (busy) return;
        busy = true;
        run()
          .catch((err: unknown) => logger.error({ err }, 'auto-stop job failed'))
          .finally(() => (busy = false));
      }, intervalMs);
      timer.unref();
      return () => clearInterval(timer);
    },
  };
}

export type AutoStopJob = ReturnType<typeof createAutoStopJob>;
