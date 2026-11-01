import type { RequestHandler } from 'express';
import type { ChangeRoleRequest, ListUsersQuery, Page, UserResponse } from '@tempo/shared';
import { requestContext } from '../../lib/request-context.ts';
import { validatedBody, validatedParams, validatedQuery } from '../../middleware/validate.ts';
import { requireAuth } from '../auth/auth.http.ts';
import { toPendingInviteResponse, toUserResponse } from './users.mappers.ts';
import type { UsersService } from './users.service.ts';

type IdParams = { id: string };

export function createUsersController(users: UsersService) {
  const list: RequestHandler = async (req, res) => {
    const query = validatedQuery<ListUsersQuery>(req);
    const { items, total } = await users.list(query);
    const body: Page<UserResponse> = {
      items: items.map(toUserResponse),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
    res.json(body);
  };

  const get: RequestHandler = async (req, res) => {
    res.json(toUserResponse(await users.get(validatedParams<IdParams>(req).id)));
  };

  const changeRole: RequestHandler = async (req, res) => {
    const { role } = validatedBody<ChangeRoleRequest>(req);
    const user = await users.changeRole(
      requireAuth(req),
      validatedParams<IdParams>(req).id,
      role,
      requestContext(req),
    );
    res.json(toUserResponse(user));
  };

  const deactivate: RequestHandler = async (req, res) => {
    res.json(
      toUserResponse(
        await users.deactivate(
          requireAuth(req),
          validatedParams<IdParams>(req).id,
          requestContext(req),
        ),
      ),
    );
  };

  const activate: RequestHandler = async (req, res) => {
    res.json(
      toUserResponse(
        await users.activate(
          requireAuth(req),
          validatedParams<IdParams>(req).id,
          requestContext(req),
        ),
      ),
    );
  };

  const revokeSessions: RequestHandler = async (req, res) => {
    await users.revokeSessions(
      requireAuth(req),
      validatedParams<IdParams>(req).id,
      requestContext(req),
    );
    res.status(204).end();
  };

  const listInvites: RequestHandler = async (_req, res) => {
    res.json((await users.listPendingInvites()).map(toPendingInviteResponse));
  };

  const revokeInvite: RequestHandler = async (req, res) => {
    await users.revokeInvite(
      requireAuth(req),
      validatedParams<IdParams>(req).id,
      requestContext(req),
    );
    res.status(204).end();
  };

  return { list, get, changeRole, deactivate, activate, revokeSessions, listInvites, revokeInvite };
}
