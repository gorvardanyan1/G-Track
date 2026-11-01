import type { Clock } from '../../lib/clock.ts';

export const LOCKOUT_THRESHOLD = 5;
const BASE_LOCK_MS = 60_000;
const MAX_LOCK_MS = 60 * 60_000;

/** Exponential backoff: 5th failure → 1 min, 6th → 2 min, 7th → 4 min … capped at 1 h. */
export function lockDurationMs(failedCount: number): number {
  if (failedCount < LOCKOUT_THRESHOLD) return 0;
  return Math.min(BASE_LOCK_MS * 2 ** (failedCount - LOCKOUT_THRESHOLD), MAX_LOCK_MS);
}

/**
 * Applies the same lockout to emails that have no account, so lockout behaviour can't be used
 * to find out which emails are registered. In memory: entries expire after a day.
 */
export function createUnknownEmailLockout(clock: Clock) {
  const entries = new Map<string, { count: number; lockedUntil: number; lastFailure: number }>();
  const DAY = 86_400_000;

  return {
    retryAfterMs(email: string): number {
      const entry = entries.get(email);
      if (!entry) return 0;
      const now = clock().getTime();
      if (now - entry.lastFailure > DAY) {
        entries.delete(email);
        return 0;
      }
      return Math.max(0, entry.lockedUntil - now);
    },
    recordFailure(email: string): void {
      const now = clock().getTime();
      if (entries.size > 50_000) entries.clear();
      const previous = entries.get(email);
      const count = previous && now - previous.lastFailure <= DAY ? previous.count + 1 : 1;
      entries.set(email, { count, lockedUntil: now + lockDurationMs(count), lastFailure: now });
    },
  };
}

export type UnknownEmailLockout = ReturnType<typeof createUnknownEmailLockout>;
