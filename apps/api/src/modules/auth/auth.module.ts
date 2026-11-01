import type { RequestHandler, Router } from 'express';
import { authenticate } from '../../middleware/authenticate.ts';
import type { PrismaClient } from '../../db/prisma.ts';
import type { BackgroundRunner } from '../../lib/background.ts';
import type { Clock } from '../../lib/clock.ts';
import type { EventBus } from '../../lib/event-bus.ts';
import { createJwtService } from '../../lib/jwt.ts';
import type { Mailer } from '../../lib/mailer.ts';
import { createSecretBox } from '../../lib/secret-box.ts';
import type { RateLimiter } from '../../middleware/rate-limit.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { createAuthController } from './auth.controller.ts';
import { createAuthRouter } from './auth.routes.ts';
import { createAuthService } from './auth.service.ts';
import { createInviteController } from './invite.controller.ts';
import { createInviteRepository } from './invite.repository.ts';
import { createInviteService } from './invite.service.ts';
import { createUnknownEmailLockout } from './lockout.ts';
import { createPasswordResetController } from './password-reset.controller.ts';
import { createPasswordResetRepository } from './password-reset.repository.ts';
import { createPasswordResetService } from './password-reset.service.ts';
import { createRecoveryCodeRepository } from './recovery-code.repository.ts';
import { createRefreshTokenRepository } from './refresh-token.repository.ts';
import { createSessionService, type SessionService } from './session.service.ts';
import { createTwoFactorService } from './two-factor.service.ts';
import { createAuthUserRepository } from './users.repository.ts';

export interface AuthModuleDeps {
  prisma: PrismaClient;
  audit: AuditService;
  mailer: Mailer;
  background: BackgroundRunner;
  clock: Clock;
  rateLimit: RateLimiter;
  events: EventBus;
  config: {
    jwtSecret: string;
    totpEncryptionKey: string;
    refreshTokenTtlDays: number;
    webAppUrl: string;
    allowedOrigins: readonly string[];
  };
}

export interface AuthModule {
  router: Router;
  sessions: SessionService;
  /** Access-token middleware for every other module. */
  authenticate: RequestHandler;
  /** Invite creation handler, mounted by the users module (POST /users/invites). */
  createInvite: RequestHandler;
}

/** Wires repositories → services → controllers → router. */
export function createAuthModule(deps: AuthModuleDeps): AuthModule {
  const { prisma, audit, mailer, background, clock, rateLimit, events, config } = deps;
  const users = createAuthUserRepository(prisma);
  const jwt = createJwtService(config.jwtSecret, clock);

  const sessions = createSessionService({
    refreshTokens: createRefreshTokenRepository(prisma),
    jwt,
    audit,
    clock,
    refreshTokenTtlMs: config.refreshTokenTtlDays * 86_400_000,
    events,
  });
  const twoFactor = createTwoFactorService({
    users,
    recoveryCodes: createRecoveryCodeRepository(prisma),
    secretBox: createSecretBox(config.totpEncryptionKey),
    clock,
  });
  const auth = createAuthService({
    users,
    sessions,
    twoFactor,
    jwt,
    audit,
    unknownEmails: createUnknownEmailLockout(clock),
    clock,
  });
  const invites = createInviteService({
    invites: createInviteRepository(prisma),
    users,
    auth,
    audit,
    mailer,
    clock,
    webAppUrl: config.webAppUrl,
  });
  const passwordReset = createPasswordResetService({
    resets: createPasswordResetRepository(prisma),
    users,
    audit,
    mailer,
    background,
    clock,
    events,
    webAppUrl: config.webAppUrl,
  });

  const inviteController = createInviteController(invites);
  const router = createAuthRouter({
    controllers: {
      auth: createAuthController(auth),
      invites: inviteController,
      passwordReset: createPasswordResetController(passwordReset),
    },
    sessions,
    rateLimit,
    allowedOrigins: config.allowedOrigins,
  });
  return {
    router,
    sessions,
    authenticate: authenticate(sessions),
    createInvite: inviteController.create,
  };
}
