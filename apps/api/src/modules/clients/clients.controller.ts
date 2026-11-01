import type { RequestHandler } from 'express';
import type {
  ClientResponse,
  CreateClientRequest,
  ListClientsQuery,
  UpdateClientRequest,
} from '@tempo/shared';
import type { Client } from '../../generated/prisma/client.ts';
import { requestContext } from '../../lib/request-context.ts';
import { validatedBody, validatedParams, validatedQuery } from '../../middleware/validate.ts';
import { requireAuth } from '../auth/auth.http.ts';
import type { ClientsService } from './clients.service.ts';

const toResponse = (client: Client): ClientResponse => ({
  id: client.id,
  name: client.name,
  archivedAt: client.archivedAt?.toISOString() ?? null,
});

type IdParams = { id: string };

export function createClientsController(clients: ClientsService) {
  const list: RequestHandler = async (req, res) => {
    const { includeArchived } = validatedQuery<ListClientsQuery>(req);
    res.json((await clients.list(includeArchived)).map(toResponse));
  };

  const get: RequestHandler = async (req, res) => {
    res.json(toResponse(await clients.get(validatedParams<IdParams>(req).id)));
  };

  const create: RequestHandler = async (req, res) => {
    const { name } = validatedBody<CreateClientRequest>(req);
    res
      .status(201)
      .json(toResponse(await clients.create(requireAuth(req), name, requestContext(req))));
  };

  const update: RequestHandler = async (req, res) => {
    const { name } = validatedBody<UpdateClientRequest>(req);
    const client = await clients.rename(
      requireAuth(req),
      validatedParams<IdParams>(req).id,
      name,
      requestContext(req),
    );
    res.json(toResponse(client));
  };

  const archive =
    (archived: boolean): RequestHandler =>
    async (req, res) => {
      const client = await clients.setArchived(
        requireAuth(req),
        validatedParams<IdParams>(req).id,
        archived,
        requestContext(req),
      );
      res.json(toResponse(client));
    };

  return { list, get, create, update, archive: archive(true), unarchive: archive(false) };
}
