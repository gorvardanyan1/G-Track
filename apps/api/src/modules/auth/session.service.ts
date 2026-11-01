import { randomUUID } from 'node:crypto';
import { UserRole } from '@tempo/shared';
import { ConflictError, ForbiddenError, UnauthorizedError } from '../../errors/app-error.ts';
import type { User } from '../../generated/prisma/client.ts';
import type { Clock } from '../../lib/clock.ts';
import type { EventBus } from '../../lib/event-bus.ts';
import type { JwtService } from '../../lib/jwt.ts';
import type { RequestContext } from '../../lib/request-context.ts';
import { randomToken, sha256Hex } from '../../lib/tokens.ts';
import { AuditAction } from '../audit/audit-actions.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_REUSE_GRACE_MS } from './auth.constants.ts';
import type { AuthContext } from './auth.types.ts';
import { RotationRaceError, type RefreshTokenRepository } from './refresh-token.repository.ts';

export interface IssuedSession {
  accessToken: string;
  accessTokenExpiresAt: Date;
  /** Raw refresh token: goes into the httpOnly cookie, only its hash is stored. */
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: User;
}

interface Deps {
  refreshTokens: RefreshTokenRepository;
  jwt: JwtService;
  audit: AuditService;
  clock: Clock;
  refreshTokenTtlMs: number;
  events: EventBus;
}

const invalidSession = () =>
  new UnauthorizedError('Session expired, please sign in again', 'INVALID_TOKEN');

export function createSessionService({
  refreshTokens,
  jwt,
  audit,
  clock,
  refreshTokenTtlMs,
  events,
}: Deps) {
  /** Ends a session family and tells live connections of that session to close. */
  async function revokeFamily(userId: string, familyId: string, at: Date): Promise<void> {
    await refreshTokens.revokeFamily(familyId, at);
    events.publish({ type: 'sessions.revoked', userId, sessionId: familyId });
  }

  function newRefreshToken(user: User, familyId: string, context: RequestContext) {
    const raw = randomToken();
    const expiresAt = new Date(clock().getTime() + refreshTokenTtlMs);
    return {
      raw,
      record: {
        userId: user.id,
        familyId,
        tokenHash: sha256Hex(raw),
        expiresAt,
        ip: context.ip,
        userAgent: context.userAgent,
      },
    };
  }

  function accessTokenFor(user: User, familyId: string) {
    return jwt.sign({ sub: user.id, typ: 'access', sid: familyId }, ACCESS_TOKEN_TTL_SECONDS);
  }

  /** Checks the user behind a token is still allowed in at all. */
  function assertUsable(user: User): void {
    if (!user.isActive) throw invalidSession();
    // 2FA is mandatory for Super Admins; a session without it must not be usable.
    if (user.role === UserRole.SUPER_ADMIN && user.totpEnabledAt === null) {
      throw new ForbiddenError(
        'Two-factor authentication is required for this account',
        'TWO_FACTOR_REQUIRED',
      );
    }
  }

  async function verifyAccessToken(token: string): Promise<{ auth: AuthContext; expiresAt: Date }> {
    const claims = jwt.verify(token, 'access');
    if (!claims.sid) throw invalidSession();
    const user = await refreshTokens.findActiveSessionUser(claims.sid, claims.sub, clock());
    if (!user) throw invalidSession();
    assertUsable(user);
    return {
      auth: { userId: user.id, role: user.role, sessionId: claims.sid, setupOnly: false },
      expiresAt: new Date(claims.exp * 1000),
    };
  }

  return {
    /** Starts a new session family (login). */
    async issue(user: User, context: RequestContext): Promise<IssuedSession> {
      const familyId = randomUUID();
      const { raw, record } = newRefreshToken(user, familyId, context);
      await refreshTokens.create(record);
      const access = accessTokenFor(user, familyId);
      return {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken: raw,
        refreshTokenExpiresAt: record.expiresAt,
        user,
      };
    },

    /**
     * Exchanges a refresh token for a new pair. Presenting a token that was already rotated
     * means it leaked (or a client is buggy): the whole family is revoked.
     */
    async rotate(rawToken: string, context: RequestContext): Promise<IssuedSession> {
      const now = clock();
      const current = await refreshTokens.findByHash(sha256Hex(rawToken));
      if (!current) throw invalidSession();

      if (current.replacedById !== null) {
        const rotatedAt = current.revokedAt?.getTime() ?? 0;
        if (now.getTime() - rotatedAt < REFRESH_REUSE_GRACE_MS) {
          throw new ConflictError('Session is being refreshed by another request, retry shortly');
        }
        await revokeFamily(current.userId, current.familyId, now);
        await audit.record(
          AuditAction.REFRESH_TOKEN_REUSED,
          {
            actorId: current.userId,
            targetType: 'session',
            targetId: current.familyId,
            after: { tokenId: current.id },
          },
          context,
        );
        throw invalidSession();
      }
      if (current.revokedAt !== null || current.expiresAt <= now) throw invalidSession();

      const user = current.user;
      try {
        assertUsable(user);
      } catch (err) {
        await revokeFamily(current.userId, current.familyId, now);
        throw err;
      }

      const { raw, record } = newRefreshToken(user, current.familyId, context);
      try {
        await refreshTokens.rotate(current.id, record, now);
      } catch (err) {
        if (err instanceof RotationRaceError) {
          throw new ConflictError('Session is being refreshed by another request, retry shortly');
        }
        throw err;
      }
      const access = accessTokenFor(user, current.familyId);
      return {
        accessToken: access.token,
        accessTokenExpiresAt: access.expiresAt,
        refreshToken: raw,
        refreshTokenExpiresAt: record.expiresAt,
        user,
      };
    },

    /** Ends the session the refresh token belongs to. Returns its user id, if the token was known. */
    async revokeByRefreshToken(
      rawToken: string,
    ): Promise<{ userId: string; familyId: string } | null> {
      const token = await refreshTokens.findByHash(sha256Hex(rawToken));
      if (!token) return null;
      await revokeFamily(token.userId, token.familyId, clock());
      return { userId: token.userId, familyId: token.familyId };
    },

    /** Ends every session of the user except `keepFamilyId` (e.g. after a password change). */
    async revokeOtherSessions(userId: string, keepFamilyId: string | null): Promise<number> {
      const now = clock();
      const others = (await refreshTokens.activeFamilies(userId, now)).filter(
        (familyId) => familyId !== keepFamilyId,
      );
      for (const familyId of others) await revokeFamily(userId, familyId, now);
      return others.length;
    },

    async revokeAllForUser(userId: string) {
      const result = await refreshTokens.revokeAllForUser(userId, clock());
      events.publish({ type: 'sessions.revoked', userId });
      return result;
    },

    /** Validates an access token and that its session is still live; role comes from the DB. */
    async authenticateAccessToken(token: string): Promise<AuthContext> {
      return (await verifyAccessToken(token)).auth;
    },

    /** Same checks, plus when the token expires (live connections close at that moment). */
    authenticateAccessTokenWithExpiry: verifyAccessToken,

    /** Accepts an access token, or the setup token of a user who must enrol in 2FA. */
    async authenticateSetupOrAccessToken(token: string): Promise<AuthContext> {
      let claims;
      try {
        claims = jwt.verify(token, 'mfa_setup');
      } catch {
        return this.authenticateAccessToken(token);
      }
      const user = await refreshTokens.findUserForSetup(claims.sub);
      if (!user?.isActive || user.totpEnabledAt !== null) throw invalidSession();
      return { userId: user.id, role: user.role, sessionId: null, setupOnly: true };
    },
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
