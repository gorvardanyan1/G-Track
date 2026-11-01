import { Router } from 'express';
import {
  acceptInviteRequestSchema,
  changePasswordRequestSchema,
  disableTwoFactorRequestSchema,
  forgotPasswordRequestSchema,
  inviteTokenRequestSchema,
  loginRequestSchema,
  resetPasswordRequestSchema,
  twoFactorCodeRequestSchema,
  twoFactorLoginRequestSchema,
  updateProfileRequestSchema,
} from '@tempo/shared';
import { authenticate, authenticateForTwoFactorSetup } from '../../middleware/authenticate.ts';
import { requireAllowedOrigin } from '../../middleware/origin-check.ts';
import { byBodyEmail, type RateLimiter } from '../../middleware/rate-limit.ts';
import { validateBody } from '../../middleware/validate.ts';
import type { createAuthController } from './auth.controller.ts';
import type { createInviteController } from './invite.controller.ts';
import type { createPasswordResetController } from './password-reset.controller.ts';
import type { SessionService } from './session.service.ts';

const MINUTE = 60_000;

interface Deps {
  controllers: {
    auth: ReturnType<typeof createAuthController>;
    invites: ReturnType<typeof createInviteController>;
    passwordReset: ReturnType<typeof createPasswordResetController>;
  };
  sessions: SessionService;
  rateLimit: RateLimiter;
  allowedOrigins: readonly string[];
}

export function createAuthRouter({
  controllers,
  sessions,
  rateLimit,
  allowedOrigins,
}: Deps): Router {
  const { auth, invites, passwordReset } = controllers;
  const router = Router();
  // Every route that reads or sets the refresh cookie checks Origin (CSRF).
  const cookieOrigin = requireAllowedOrigin(allowedOrigins);
  const byUser = (req: { auth?: { userId: string } }) => req.auth?.userId ?? null;

  router.post(
    '/login',
    cookieOrigin,
    rateLimit({ name: 'login-ip', windowMs: 15 * MINUTE, max: 30 }),
    validateBody(loginRequestSchema),
    rateLimit({ name: 'login-email', windowMs: 15 * MINUTE, max: 10, key: byBodyEmail }),
    auth.login,
  );
  router.post(
    '/login/2fa',
    cookieOrigin,
    rateLimit({ name: 'login-2fa-ip', windowMs: 15 * MINUTE, max: 20 }),
    validateBody(twoFactorLoginRequestSchema),
    auth.loginTwoFactor,
  );
  router.post(
    '/refresh',
    cookieOrigin,
    rateLimit({ name: 'refresh-ip', windowMs: 15 * MINUTE, max: 120 }),
    auth.refresh,
  );
  router.post('/logout', cookieOrigin, auth.logout);
  router.post('/logout-all', cookieOrigin, authenticate(sessions), auth.logoutAll);
  router.get('/me', authenticate(sessions), auth.me);
  router.patch(
    '/me',
    authenticate(sessions),
    validateBody(updateProfileRequestSchema),
    auth.updateProfile,
  );
  router.post(
    '/password',
    authenticate(sessions),
    rateLimit({ name: 'password-change', windowMs: 15 * MINUTE, max: 10, key: byUser }),
    validateBody(changePasswordRequestSchema),
    auth.changePassword,
  );

  router.post(
    '/2fa/setup',
    authenticateForTwoFactorSetup(sessions),
    rateLimit({ name: '2fa-setup', windowMs: 15 * MINUTE, max: 10, key: byUser }),
    auth.startTwoFactorSetup,
  );
  router.post(
    '/2fa/enable',
    cookieOrigin,
    authenticateForTwoFactorSetup(sessions),
    rateLimit({ name: '2fa-enable', windowMs: 15 * MINUTE, max: 10, key: byUser }),
    validateBody(twoFactorCodeRequestSchema),
    auth.enableTwoFactor,
  );
  router.post(
    '/2fa/disable',
    authenticate(sessions),
    rateLimit({ name: '2fa-disable', windowMs: 15 * MINUTE, max: 10, key: byUser }),
    validateBody(disableTwoFactorRequestSchema),
    auth.disableTwoFactor,
  );

  router.post(
    '/invites/inspect',
    rateLimit({ name: 'invites-inspect-ip', windowMs: 15 * MINUTE, max: 30 }),
    validateBody(inviteTokenRequestSchema),
    invites.inspect,
  );
  router.post(
    '/invites/accept',
    cookieOrigin,
    rateLimit({ name: 'invites-accept-ip', windowMs: 15 * MINUTE, max: 20 }),
    validateBody(acceptInviteRequestSchema),
    invites.accept,
  );

  router.post(
    '/password/forgot',
    rateLimit({ name: 'forgot-ip', windowMs: 15 * MINUTE, max: 10 }),
    validateBody(forgotPasswordRequestSchema),
    rateLimit({ name: 'forgot-email', windowMs: 60 * MINUTE, max: 3, key: byBodyEmail }),
    passwordReset.forgot,
  );
  router.post(
    '/password/reset',
    rateLimit({ name: 'reset-ip', windowMs: 15 * MINUTE, max: 10 }),
    validateBody(resetPasswordRequestSchema),
    passwordReset.reset,
  );

  return router;
}
