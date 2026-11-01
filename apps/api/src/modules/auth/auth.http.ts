import type { Request, Response } from 'express';
import {
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  type AuthenticatedResponse,
  type LoginResponse,
} from '@tempo/shared';
import { UnauthorizedError } from '../../errors/app-error.ts';
import type { AuthContext } from './auth.types.ts';
import type { LoginOutcome } from './auth.service.ts';
import { toAuthUser } from './auth.mappers.ts';
import type { IssuedSession } from './session.service.ts';

// httpOnly: invisible to JS. Secure: browsers also allow it on http://localhost. Strict: never
// sent on cross-site requests. Path: only sent to the auth routes, not every API call.
const cookieOptions = {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  path: REFRESH_COOKIE_PATH,
} as const;

export function setRefreshCookie(res: Response, session: IssuedSession): void {
  res.cookie(REFRESH_COOKIE_NAME, session.refreshToken, {
    ...cookieOptions,
    expires: session.refreshTokenExpiresAt,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, cookieOptions);
}

/** Reads the refresh cookie without a cookie-parser dependency. */
export function readRefreshCookie(req: Request): string | null {
  const header = req.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === REFRESH_COOKIE_NAME) {
      const value = rest.join('=');
      return /^[A-Za-z0-9_-]{20,200}$/.test(value) ? value : null;
    }
  }
  return null;
}

export function authenticatedBody(session: IssuedSession): AuthenticatedResponse {
  return {
    status: 'authenticated',
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt.toISOString(),
    user: toAuthUser(session.user),
  };
}

/** Sets the cookie when a session was issued and returns the public response body. */
export function sendLoginOutcome(res: Response, outcome: LoginOutcome, status = 200): void {
  let body: LoginResponse;
  if (outcome.status === 'authenticated') {
    setRefreshCookie(res, outcome.session);
    body = authenticatedBody(outcome.session);
  } else {
    body = outcome;
  }
  res.status(status).json(body);
}

export function requireAuth(req: Request): AuthContext {
  if (!req.auth) throw new UnauthorizedError();
  return req.auth;
}
