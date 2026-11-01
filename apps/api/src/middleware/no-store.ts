import type { RequestHandler } from 'express';

/** API responses are per-user and time-sensitive; never let caches reuse them. */
export function noStore(): RequestHandler {
  return (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
}
