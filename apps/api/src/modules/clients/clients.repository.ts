import type { PrismaClient } from '../../db/prisma.ts';

export function createClientsRepository(prisma: PrismaClient) {
  return {
    list: (includeArchived: boolean) =>
      prisma.client.findMany({
        where: includeArchived ? {} : { archivedAt: null },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    findById: (id: string) => prisma.client.findUnique({ where: { id } }),
    create: (name: string) => prisma.client.create({ data: { name } }),
    update: (id: string, data: { name?: string; archivedAt?: Date | null }) =>
      prisma.client.update({ where: { id }, data }),
  };
}

export type ClientsRepository = ReturnType<typeof createClientsRepository>;
