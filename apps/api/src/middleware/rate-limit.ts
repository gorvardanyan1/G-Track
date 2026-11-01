import type { Request, RequestHandler } from 'express';
import { TooManyRequestsError } from '../errors/app-error.ts';
import type { Clock } from '../lib/clock.ts';

export interface RateLimitRule {
  name: string;
  windowMs: number;
  max: number;
  /** Bucket key; return null to skip limiting this request. Defaults to the client IP. */
  key?: (req: Request) => string | null;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window limiter kept in process memory. Good for a single api instance; a shared
 * store (e.g. Redis) is needed once the api runs on several instances.
 */
export function createRateLimiter(clock: Clock) {
  const buckets = new Map<string, Bucket>();

  function sweep(now: number) {
    if (buckets.size < 10_000) return;
    for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
  }

  return function rateLimit(rule: RateLimitRule): RequestHandler {
    return (req, res, next) => {
      const key = rule.key ? rule.key(req) : (req.ip ?? 'unknown');
      if (key === null) {
        next();
        return;
      }
      const now = clock().getTime();
      sweep(now);
      const id = `${rule.name}:${key}`;
      let bucket = buckets.get(id);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { count: 0, resetAt: now + rule.windowMs };
        buckets.set(id, bucket);
      }
      bucket.count += 1;

      const resetSeconds = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('RateLimit-Limit', String(rule.max));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, rule.max - bucket.count)));
      res.setHeader('RateLimit-Reset', String(resetSeconds));
      if (bucket.count > rule.max) {
        throw new TooManyRequestsError('Too many requests, please try again later', resetSeconds);
      }
      next();
    };
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;

/** Key by the (validated, normalized) email in the body, so it must run after validateBody. */
export const byBodyEmail = (req: Request): string | null => {
  const email: unknown = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' ? email : null;
};
