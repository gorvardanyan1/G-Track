import { UserRole } from '@tempo/shared';
import { BadRequestError, ConflictError, ForbiddenError } from '../../errors/app-error.ts';
import type { User } from '../../generated/prisma/client.ts';
import type { Clock } from '../../lib/clock.ts';
import { generateRecoveryCodes, hashRecoveryCode } from '../../lib/recovery-codes.ts';
import type { SecretBox } from '../../lib/secret-box.ts';
import { generateTotpSecret, otpauthUrl, verifyTotp } from '../../lib/totp.ts';
import { TOTP_ISSUER } from './auth.constants.ts';
import type { RecoveryCodeRepository } from './recovery-code.repository.ts';
import type { AuthUserRepository } from './users.repository.ts';

interface Deps {
  users: AuthUserRepository;
  recoveryCodes: RecoveryCodeRepository;
  secretBox: SecretBox;
  clock: Clock;
}

const invalidCode = () =>
  new BadRequestError('The code is not valid', { code: 'INVALID_TWO_FACTOR_CODE' });

/** TOTP secrets and recovery codes. Orchestration (sessions, audit) lives in AuthService. */
export function createTwoFactorService({ users, recoveryCodes, secretBox, clock }: Deps) {
  const secretOf = (user: User): string | null =>
    user.totpSecretEncrypted ? secretBox.decrypt(user.totpSecretEncrypted, user.id) : null;

  return {
    /** Generates a new (pending) secret; 2FA is only on after `enable` confirms a code. */
    async startSetup(user: User) {
      if (user.totpEnabledAt !== null)
        throw new ConflictError('Two-factor authentication is already enabled');
      const secret = generateTotpSecret();
      await users.setPendingTotpSecret(user.id, secretBox.encrypt(secret, user.id));
      return {
        secret,
        otpauthUrl: otpauthUrl({ secret, accountName: user.email, issuer: TOTP_ISSUER }),
      };
    },

    /** Confirms the pending secret with a code and returns fresh recovery codes (shown once). */
    async enable(user: User, code: string): Promise<string[]> {
      if (user.totpEnabledAt !== null)
        throw new ConflictError('Two-factor authentication is already enabled');
      const secret = secretOf(user);
      if (!secret) throw new BadRequestError('Start two-factor setup first');
      const step = verifyTotp(secret, code, clock());
      if (step === null) throw invalidCode();

      const codes = generateRecoveryCodes();
      await recoveryCodes.replaceAll(user.id, codes.map(hashRecoveryCode));
      await users.enableTotp(user.id, clock(), step);
      return codes;
    },

    /** Login step two. Each code works once (replay protection via the last used step). */
    async verifyLoginCode(user: User, code: string): Promise<boolean> {
      const secret = secretOf(user);
      if (!secret || user.totpEnabledAt === null) return false;
      const step = verifyTotp(secret, code, clock());
      return step !== null && (await users.claimTotpStep(user.id, step));
    },

    consumeRecoveryCode: (user: User, code: string) =>
      recoveryCodes.consume(user.id, hashRecoveryCode(code), clock()),

    remainingRecoveryCodes: (user: User) => recoveryCodes.countUnused(user.id),

    async disable(user: User, code: string): Promise<void> {
      if (user.role === UserRole.SUPER_ADMIN) {
        throw new ForbiddenError('Two-factor authentication is required for Super Admins');
      }
      if (!(await this.verifyLoginCode(user, code))) throw invalidCode();
      await recoveryCodes.deleteAll(user.id);
      await users.clearTotp(user.id);
    },
  };
}

export type TwoFactorService = ReturnType<typeof createTwoFactorService>;
