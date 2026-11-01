import type { ForgotPasswordRequest, ResetPasswordRequest } from '@tempo/shared';
import { BadRequestError } from '../../errors/app-error.ts';
import type { BackgroundRunner } from '../../lib/background.ts';
import type { Clock } from '../../lib/clock.ts';
import type { EventBus } from '../../lib/event-bus.ts';
import type { Mailer } from '../../lib/mailer.ts';
import { hashPassword } from '../../lib/password.ts';
import type { RequestContext } from '../../lib/request-context.ts';
import { randomToken, sha256Hex } from '../../lib/tokens.ts';
import { AuditAction } from '../audit/audit-actions.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { PASSWORD_RESET_TTL_MS } from './auth.constants.ts';
import type { PasswordResetRepository } from './password-reset.repository.ts';
import { assertPasswordPolicy } from './password-policy.ts';
import type { AuthUserRepository } from './users.repository.ts';

interface Deps {
  resets: PasswordResetRepository;
  users: AuthUserRepository;
  audit: AuditService;
  mailer: Mailer;
  background: BackgroundRunner;
  clock: Clock;
  events: EventBus;
  webAppUrl: string;
}

const invalidReset = () =>
  new BadRequestError('This reset link is invalid or has expired', { code: 'INVALID_TOKEN' });

export function createPasswordResetService({
  resets,
  users,
  audit,
  mailer,
  background,
  clock,
  events,
  webAppUrl,
}: Deps) {
  async function sendResetMail(email: string, context: RequestContext): Promise<void> {
    const user = await users.findByEmail(email);
    const eligible = user !== null && user.isActive;
    await audit.record(
      AuditAction.PASSWORD_RESET_REQUESTED,
      {
        actorId: user?.id ?? null,
        targetType: 'user',
        targetId: user?.id ?? null,
        after: { email, matched: eligible },
      },
      context,
    );
    if (!eligible) return;

    const token = randomToken();
    const now = clock();
    await resets.replace(
      {
        userId: user.id,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(now.getTime() + PASSWORD_RESET_TTL_MS),
        ip: context.ip,
      },
      now,
    );
    await mailer.send({
      to: user.email,
      subject: 'Reset your TEMPO password',
      text: `Use this link within 30 minutes to choose a new password:\n\n${webAppUrl}/reset-password#token=${token}\n\nIf you didn’t ask for this, you can ignore this email.`,
    });
  }

  return {
    /**
     * Always resolves immediately with nothing to report: the lookup and mail happen in the
     * background so neither the response nor its timing reveals whether the email exists.
     */
    request({ email }: ForgotPasswordRequest, context: RequestContext): void {
      background.run('password-reset-mail', () => sendResetMail(email, context));
    },

    async reset({ token, password }: ResetPasswordRequest, context: RequestContext): Promise<void> {
      const now = clock();
      const reset = await resets.findUsable(sha256Hex(token), now);
      if (!reset?.user.isActive) throw invalidReset();
      assertPasswordPolicy(password, { email: reset.user.email, name: reset.user.name });

      const completed = await resets.complete(
        reset.id,
        reset.userId,
        await hashPassword(password),
        now,
      );
      if (!completed) throw invalidReset();
      events.publish({ type: 'sessions.revoked', userId: reset.userId });
      await audit.record(
        AuditAction.PASSWORD_RESET_COMPLETED,
        {
          actorId: reset.userId,
          targetType: 'user',
          targetId: reset.userId,
          after: { sessionsRevoked: true },
        },
        context,
      );
    },
  };
}

export type PasswordResetService = ReturnType<typeof createPasswordResetService>;
