import type { RequestHandler } from 'express';
import { UnauthorizedError } from '../errors/app-error.ts';
import type { SessionService } from '../modules/auth/session.service.ts';

function bearerToken(header: string | undefined): string | null {
  const match = header?.match(/^Bearer ([A-Za-z0-9._~+/=-]+)$/);
  return match?.[1] ?? null;
}

/** Requires a valid access token whose session is still active; sets req.auth. */
export function authenticate(sessions: SessionService): RequestHandler {
  return async (req, _res, next) => {
    const token = bearerToken(req.get('authorization'));
    if (!token) throw new UnauthorizedError();
    req.auth = await sessions.authenticateAccessToken(token);
    next();
  };
}

/**
 * Like authenticate, but also accepts the short-lived setup token a Super Admin gets at login
 * before enrolling in 2FA. Only for the 2FA setup endpoints.
 */
export function authenticateForTwoFactorSetup(sessions: SessionService): RequestHandler {
  return async (req, _res, next) => {
    const token = bearerToken(req.get('authorization'));
    if (!token) throw new UnauthorizedError();
    req.auth = await sessions.authenticateSetupOrAccessToken(token);
    next();
  };
}
