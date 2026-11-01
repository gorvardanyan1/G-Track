import type { CreateInviteRequest, AcceptInviteRequest } from '@tempo/shared';
import { BadRequestError, ConflictError } from '../../errors/app-error.ts';
import { Prisma } from '../../generated/prisma/client.ts';
import type { Clock } from '../../lib/clock.ts';
import type { Mailer } from '../../lib/mailer.ts';
import { hashPassword } from '../../lib/password.ts';
import type { RequestContext } from '../../lib/request-context.ts';
import { randomToken, sha256Hex } from '../../lib/tokens.ts';
import { AuditAction } from '../audit/audit-actions.ts';
import type { AuditService } from '../audit/audit.service.ts';
import { INVITE_TTL_MS } from './auth.constants.ts';
import type { AuthService, LoginOutcome } from './auth.service.ts';
import type { AuthContext } from './auth.types.ts';
import { InviteAlreadyUsedError, type InviteRepository } from './invite.repository.ts';
import { assertPasswordPolicy } from './password-policy.ts';
import type { AuthUserRepository } from './users.repository.ts';

interface Deps {
  invites: InviteRepository;
  users: AuthUserRepository;
  auth: AuthService;
  audit: AuditService;
  mailer: Mailer;
  clock: Clock;
  webAppUrl: string;
}

const invalidInvite = () =>
  new BadRequestError('This invite link is invalid or has expired', { code: 'INVALID_TOKEN' });

export function createInviteService({
  invites,
  users,
  auth,
  audit,
  mailer,
  clock,
  webAppUrl,
}: Deps) {
  async function findUsable(token: string) {
    const invite = await invites.findUsable(sha256Hex(token), clock());
    if (!invite) throw invalidInvite();
    return invite;
  }

  return {
    /** Super Admin only (enforced by the route). */
    async create(actor: AuthContext, input: CreateInviteRequest, context: RequestContext) {
      if (await users.findByEmail(input.email)) {
        throw new ConflictError('A user with this email already exists');
      }
      const token = randomToken();
      const now = clock();
      const invite = await invites.replacePending(
        {
          email: input.email,
          role: input.role,
          tokenHash: sha256Hex(token),
          invitedById: actor.userId,
          expiresAt: new Date(now.getTime() + INVITE_TTL_MS),
        },
        now,
      );
      // The token goes in the URL fragment so it never reaches server logs or Referer headers.
      await mailer.send({
        to: invite.email,
        subject: 'You’re invited to TEMPO',
        text: `You have been invited to TEMPO. Set up your account within 48 hours:\n\n${webAppUrl}/accept-invite#token=${token}\n`,
      });
      await audit.record(
        AuditAction.INVITE_CREATED,
        {
          actorId: actor.userId,
          targetType: 'invite',
          targetId: invite.id,
          after: { email: invite.email, role: invite.role },
        },
        context,
      );
      return invite;
    },

    /** Lets the accept page show who the invite is for. */
    inspect: findUsable,

    async accept(input: AcceptInviteRequest, context: RequestContext): Promise<LoginOutcome> {
      const invite = await findUsable(input.token);
      assertPasswordPolicy(input.password, { email: invite.email, name: input.name });
      const passwordHash = await hashPassword(input.password);

      let user;
      try {
        user = await invites.accept(
          invite.id,
          {
            email: invite.email,
            name: input.name,
            role: invite.role,
            timezone: input.timezone,
            passwordHash,
          },
          clock(),
        );
      } catch (err) {
        if (err instanceof InviteAlreadyUsedError) throw invalidInvite();
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw new ConflictError('A user with this email already exists');
        }
        throw err;
      }
      await audit.record(
        AuditAction.INVITE_ACCEPTED,
        {
          actorId: user.id,
          targetType: 'invite',
          targetId: invite.id,
          after: { userId: user.id, role: user.role },
        },
        context,
      );
      return auth.afterFirstFactor(user, 'invite', context);
    },
  };
}

export type InviteService = ReturnType<typeof createInviteService>;
