import { ConflictError, NotFoundError } from '../../errors/app-error.ts';
import type { Clock } from '../../lib/clock.ts';
import { isUniqueViolation } from '../../lib/prisma-errors.ts';
import type { RequestContext } from '../../lib/request-context.ts';
import { AuditAction } from '../audit/audit-actions.ts';
import type { AuditService } from '../audit/audit.service.ts';
import type { AuthContext } from '../auth/auth.types.ts';
import type { ClientsRepository } from './clients.repository.ts';

interface Deps {
  clients: ClientsRepository;
  audit: AuditService;
  clock: Clock;
}

const duplicateName = () => new ConflictError('A client with this name already exists');

/** Client management is Super Admin only (enforced by the route). */
export function createClientsService({ clients, audit, clock }: Deps) {
  async function load(id: string) {
    const client = await clients.findById(id);
    if (!client) throw new NotFoundError('Client not found');
    return client;
  }

  const record = (
    action: AuditAction,
    actor: AuthContext,
    id: string,
    context: RequestContext,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ) =>
    audit.record(
      action,
      {
        actorId: actor.userId,
        targetType: 'client',
        targetId: id,
        ...(before && { before }),
        ...(after && { after }),
      },
      context,
    );

  return {
    list: (includeArchived: boolean) => clients.list(includeArchived),
    get: load,

    async create(actor: AuthContext, name: string, context: RequestContext) {
      try {
        const client = await clients.create(name);
        await record(AuditAction.CLIENT_CREATED, actor, client.id, context, undefined, { name });
        return client;
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicateName();
        throw err;
      }
    },

    async rename(actor: AuthContext, id: string, name: string, context: RequestContext) {
      const client = await load(id);
      try {
        const updated = await clients.update(id, { name });
        await record(
          AuditAction.CLIENT_UPDATED,
          actor,
          id,
          context,
          { name: client.name },
          { name },
        );
        return updated;
      } catch (err) {
        if (isUniqueViolation(err)) throw duplicateName();
        throw err;
      }
    },

    async setArchived(actor: AuthContext, id: string, archived: boolean, context: RequestContext) {
      const client = await load(id);
      if ((client.archivedAt !== null) === archived) return client;
      const updated = await clients.update(id, { archivedAt: archived ? clock() : null });
      await record(
        archived ? AuditAction.CLIENT_ARCHIVED : AuditAction.CLIENT_UNARCHIVED,
        actor,
        id,
        context,
      );
      return updated;
    },
  };
}

export type ClientsService = ReturnType<typeof createClientsService>;
