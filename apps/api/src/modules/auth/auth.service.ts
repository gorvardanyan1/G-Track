import {
  UserRole,
  type ChangePasswordRequest,
  type LoginRequest,
  type TwoFactorLoginRequest,
  type UpdateProfileRequest,
} from '@tempo/shared';
import {
  ForbiddenError,
  NotFoundError,
  TooManyRequestsError,
  UnauthorizedError,
} from '../../errors/app-error.ts';
import type { User } from '../../generated/prisma/client.ts';
import type { Clock } from '../../lib/clock.ts';
import type { JwtService } from '../../lib/jwt.ts';
import { hashPassword, verifyPassword } from '../../lib/password.ts';
import type { RequestContext } from '../../lib/request-context.ts';
import { AuditAction } from '../audit/audit-actions.ts';
import type { AuditService } from '../audit/audit.service.ts';
import {
  TWO_FACTOR_CHALLENGE_TTL_SECONDS,
  TWO_FACTOR_SETUP_TTL_SECONDS,
} from './auth.constants.ts';
import type { AuthContext } from './auth.types.ts';
import { lockDurationMs, type UnknownEmailLockout } from './lockout.ts';
import { assertPasswordPolicy } from './password-policy.ts';
import type { IssuedSession, SessionService } from './session.service.ts';
import type { TwoFactorService } from './two-factor.service.ts';
import type { AuthUserRepository } from './users.repository.ts';

export type LoginOutcome =
  | { status: 'authenticated'; session: IssuedSession }
  | { status: 'two_factor_required'; challengeToken: string }
  | { status: 'two_factor_setup_required'; setupToken: string };

interface Deps {
  users: AuthUserRepository;
  sessions: SessionService;
  twoFactor: TwoFactorService;
  jwt: JwtService;
  audit: AuditService;
  unknownEmails: UnknownEmailLockout;
  clock: Clock;
}

const invalidCredentials = () =>
  new UnauthorizedError('Invalid email or password', 'INVALID_CREDENTIALS');
const lockedOut = (retryAfterMs: number) =>
  new TooManyRequestsError('Too many failed attempts, please try again later', retryAfterMs / 1000);

// Verifying against this when the email is unknown keeps response times the same.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword('dummy password for timing equalization'));

export function createAuthService(deps: Deps) {
  const { users, sessions, twoFactor, jwt, audit, unknownEmails, clock } = deps;

  async function recordFailure(user: User, reason: string, context: RequestContext): Promise<void> {
    const failedCount = await users.incrementFailedLogins(user.id);
    const lockMs = lockDurationMs(failedCount);
    await audit.record(
      reason === 'bad_two_factor_code' ? AuditAction.TWO_FACTOR_FAILED : AuditAction.LOGIN_FAILED,
      {
        actorId: user.id,
        targetType: 'user',
        targetId: user.id,
        after: { email: user.email, reason, failedCount },
      },
      context,
    );
    if (lockMs > 0) {
      const lockedUntil = new Date(clock().getTime() + lockMs);
      await users.lockUntil(user.id, lockedUntil);
      await audit.record(
        AuditAction.ACCOUNT_LOCKED,
        {
          actorId: user.id,
          targetType: 'user',
          targetId: user.id,
          after: { failedCount, lockedUntil: lockedUntil.toISOString() },
        },
        context,
      );
    }
  }

  async function assertNotLocked(user: User, context: RequestContext): Promise<void> {
    const remaining = (user.lockedUntil?.getTime() ?? 0) - clock().getTime();
    if (remaining > 0) {
      await audit.record(
        AuditAction.LOGIN_FAILED,
        {
          actorId: user.id,
          targetType: 'user',
          targetId: user.id,
          after: { email: user.email, reason: 'locked' },
        },
        context,
      );
      throw lockedOut(remaining);
    }
  }

  /** Last step of every login path: resets lockout, starts a session, audits. */
  async function completeLogin(
    user: User,
    method: string,
    context: RequestContext,
  ): Promise<LoginOutcome> {
    await users.recordSuccessfulLogin(user.id, clock());
    const session = await sessions.issue(user, context);
    await audit.record(
      AuditAction.LOGIN_SUCCEEDED,
      { actorId: user.id, targetType: 'user', targetId: user.id, after: { method } },
      context,
    );
    return { status: 'authenticated', session };
  }

  /** After the password (or an invite) proved identity: 2FA challenge, forced enrolment, or done. */
  async function afterFirstFactor(
    user: User,
    method: string,
    context: RequestContext,
  ): Promise<LoginOutcome> {
    if (user.totpEnabledAt !== null) {
      const { token } = jwt.sign({ sub: user.id, typ: 'mfa' }, TWO_FACTOR_CHALLENGE_TTL_SECONDS);
      return { status: 'two_factor_required', challengeToken: token };
    }
    if (user.role === UserRole.SUPER_ADMIN) {
      const { token } = jwt.sign({ sub: user.id, typ: 'mfa_setup' }, TWO_FACTOR_SETUP_TTL_SECONDS);
      return { status: 'two_factor_setup_required', setupToken: token };
    }
    return completeLogin(user, method, context);
  }

  async function loadUser(userId: string): Promise<User> {
    const user = await users.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    return user;
  }

  return {
    afterFirstFactor,

    async login({ email, password }: LoginRequest, context: RequestContext): Promise<LoginOutcome> {
      const user = await users.findByEmail(email);

      if (!user) {
        const retryAfter = unknownEmails.retryAfterMs(email);
        if (retryAfter > 0) throw lockedOut(retryAfter);
        await verifyPassword(password, await getDummyHash());
        unknownEmails.recordFailure(email);
        await audit.record(
          AuditAction.LOGIN_FAILED,
          { targetType: 'user', after: { email, reason: 'unknown_email' } },
          context,
        );
        throw invalidCredentials();
      }

      await assertNotLocked(user, context);
      if (!(await verifyPassword(password, user.passwordHash))) {
        await recordFailure(user, 'bad_password', context);
        throw invalidCredentials();
      }
      // Only revealed to someone who knows the password.
      if (!user.isActive) {
        await audit.record(
          AuditAction.LOGIN_FAILED,
          {
            actorId: user.id,
            targetType: 'user',
            targetId: user.id,
            after: { email, reason: 'deactivated' },
          },
          context,
        );
        throw new ForbiddenError('This account has been deactivated', 'ACCOUNT_DISABLED');
      }
      return afterFirstFactor(user, 'password', context);
    },

    async loginWithTwoFactor(
      input: TwoFactorLoginRequest,
      context: RequestContext,
    ): Promise<LoginOutcome> {
      const claims = jwt.verify(input.challengeToken, 'mfa');
      const user = await users.findById(claims.sub);
      if (!user?.isActive || user.totpEnabledAt === null) throw invalidCredentials();
      await assertNotLocked(user, context);

      const ok =
        input.code !== undefined
          ? await twoFactor.verifyLoginCode(user, input.code)
          : await twoFactor.consumeRecoveryCode(user, input.recoveryCode ?? '');
      if (!ok) {
        await recordFailure(user, 'bad_two_factor_code', context);
        throw new UnauthorizedError('The code is not valid', 'INVALID_TWO_FACTOR_CODE');
      }
      if (input.recoveryCode !== undefined) {
        await audit.record(
          AuditAction.RECOVERY_CODE_USED,
          {
            actorId: user.id,
            targetType: 'user',
            targetId: user.id,
            after: { remaining: await twoFactor.remainingRecoveryCodes(user) },
          },
          context,
        );
      }
      return completeLogin(user, input.code !== undefined ? 'totp' : 'recovery_code', context);
    },

    refresh: (refreshToken: string, context: RequestContext) =>
      sessions.rotate(refreshToken, context),

    async logout(refreshToken: string | null, context: RequestContext): Promise<void> {
      if (!refreshToken) return;
      const ended = await sessions.revokeByRefreshToken(refreshToken);
      if (ended) {
        await audit.record(
          AuditAction.LOGOUT,
          { actorId: ended.userId, targetType: 'session', targetId: ended.familyId },
          context,
        );
      }
    },

    async logoutAll(auth: AuthContext, context: RequestContext): Promise<void> {
      const { count } = await sessions.revokeAllForUser(auth.userId);
      await audit.record(
        AuditAction.LOGOUT_ALL,
        {
          actorId: auth.userId,
          targetType: 'user',
          targetId: auth.userId,
          after: { sessionsRevoked: count },
        },
        context,
      );
    },

    me: (auth: AuthContext) => loadUser(auth.userId),

    /** Name and timezone; the timezone decides "today", day grouping and reports. */
    async updateProfile(auth: AuthContext, input: UpdateProfileRequest, context: RequestContext) {
      const user = await loadUser(auth.userId);
      const changed = Object.entries(input).filter(
        ([key, value]) => user[key as keyof UpdateProfileRequest] !== value,
      );
      if (changed.length === 0) return user;
      const updated = await users.updateProfile(user.id, Object.fromEntries(changed));
      await audit.record(
        AuditAction.PROFILE_UPDATED,
        {
          actorId: user.id,
          targetType: 'user',
          targetId: user.id,
          before: Object.fromEntries(
            changed.map(([key]) => [key, user[key as keyof UpdateProfileRequest]]),
          ),
          after: Object.fromEntries(changed),
        },
        context,
      );
      return updated;
    },

    /** Needs the current password; every other session is signed out afterwards. */
    async changePassword(
      auth: AuthContext,
      { currentPassword, newPassword }: ChangePasswordRequest,
      context: RequestContext,
    ): Promise<void> {
      const user = await loadUser(auth.userId);
      if (!(await verifyPassword(currentPassword, user.passwordHash))) {
        await recordFailure(user, 'bad_password', context);
        throw new UnauthorizedError('Current password is incorrect', 'INVALID_CREDENTIALS');
      }
      assertPasswordPolicy(newPassword, { email: user.email, name: user.name });
      await users.setPassword(user.id, await hashPassword(newPassword));
      const revoked = await sessions.revokeOtherSessions(user.id, auth.sessionId);
      await audit.record(
        AuditAction.PASSWORD_CHANGED,
        {
          actorId: user.id,
          targetType: 'user',
          targetId: user.id,
          after: { otherSessionsRevoked: revoked },
        },
        context,
      );
    },

    async startTwoFactorSetup(auth: AuthContext) {
      return twoFactor.startSetup(await loadUser(auth.userId));
    },

    /** Enables 2FA. If this happened during a forced-enrolment login, the login completes too. */
    async enableTwoFactor(auth: AuthContext, code: string, context: RequestContext) {
      const user = await loadUser(auth.userId);
      const recoveryCodes = await twoFactor.enable(user, code);
      await audit.record(
        AuditAction.TWO_FACTOR_ENABLED,
        { actorId: user.id, targetType: 'user', targetId: user.id },
        context,
      );
      if (!auth.setupOnly) return { recoveryCodes, outcome: null };
      const outcome = await completeLogin(
        await loadUser(user.id),
        'password+2fa_enrolment',
        context,
      );
      return { recoveryCodes, outcome };
    },

    async disableTwoFactor(
      auth: AuthContext,
      password: string,
      code: string,
      context: RequestContext,
    ) {
      const user = await loadUser(auth.userId);
      if (!(await verifyPassword(password, user.passwordHash))) {
        await recordFailure(user, 'bad_password', context);
        throw invalidCredentials();
      }
      await twoFactor.disable(user, code);
      await audit.record(
        AuditAction.TWO_FACTOR_DISABLED,
        { actorId: user.id, targetType: 'user', targetId: user.id },
        context,
      );
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
