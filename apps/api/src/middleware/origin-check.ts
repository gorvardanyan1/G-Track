import type { RequestHandler } from 'express';
import { ForbiddenError } from '../errors/app-error.ts';

/**
 * CSRF defence for endpoints that read or set the refresh cookie: the request must carry an
 * Origin header from the allowlist. Browsers always send Origin on cross-site and same-site
 * POSTs; a missing header is rejected too.
 */
export function requireAllowedOrigin(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    const origin = req.get('origin');
    if (origin === undefined || !allowed.has(origin))
      throw new ForbiddenError('Origin not allowed');
    next();
  };
}
