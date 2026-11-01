import type { RequestHandler } from 'express';
import type { UserRole } from '@tempo/shared';
import { NotFoundError, UnauthorizedError } from '../errors/app-error.ts';

/**
 * Route-level role gate (must run after authenticate). Users without the role get the same
 * 404 as an unknown route, so admin endpoints aren't revealed. Resource-level checks still
 * belong in the service layer.
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  const allowed = new Set<UserRole>(roles);
  return (req, _res, next) => {
    if (!req.auth || req.auth.setupOnly) throw new UnauthorizedError();
    if (!allowed.has(req.auth.role)) throw new NotFoundError('Route not found');
    next();
  };
}
