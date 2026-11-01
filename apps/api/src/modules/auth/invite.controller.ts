import type { RequestHandler } from 'express';
import type {
  AcceptInviteRequest,
  CreateInviteRequest,
  InviteResponse,
  InviteTokenRequest,
} from '@tempo/shared';
import { requestContext } from '../../lib/request-context.ts';
import { requireAuth, sendLoginOutcome } from './auth.http.ts';
import type { InviteService } from './invite.service.ts';

const toResponse = (invite: {
  id: string;
  email: string;
  role: InviteResponse['role'];
  expiresAt: Date;
}): InviteResponse => ({
  id: invite.id,
  email: invite.email,
  role: invite.role,
  expiresAt: invite.expiresAt.toISOString(),
});

export function createInviteController(invites: InviteService) {
  const create: RequestHandler = async (req, res) => {
    const invite = await invites.create(
      requireAuth(req),
      req.body as CreateInviteRequest,
      requestContext(req),
    );
    res.status(201).json(toResponse(invite));
  };

  const inspect: RequestHandler = async (req, res) => {
    res.json(toResponse(await invites.inspect((req.body as InviteTokenRequest).token)));
  };

  const accept: RequestHandler = async (req, res) => {
    sendLoginOutcome(
      res,
      await invites.accept(req.body as AcceptInviteRequest, requestContext(req)),
      201,
    );
  };

  return { create, inspect, accept };
}
