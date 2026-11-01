import type { PrismaClient } from '../../db/prisma.ts';
import { Prisma } from '../../generated/prisma/client.ts';

export interface AuditRow {
  action: string;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  before: unknown;
  after: unknown;
  ip: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: Date;
}

const json = (value: unknown) =>
  value === undefined || value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);

export interface AuditLogFilter {
  actorId?: string;
  /** Exact names; entries ending in "." match as prefixes. */
  actions?: string[];
  targetType?: string;
  targetId?: string;
  from?: Date;
  to?: Date;
}

export function createAuditRepository(prisma: PrismaClient) {
  return {
    async insert(row: AuditRow): Promise<void> {
      await prisma.auditLog.create({
        data: { ...row, before: json(row.before), after: json(row.after) },
      });
    },

    viewerTimezone: async (userId: string) =>
      (await prisma.user.findUnique({ where: { id: userId }, select: { timezone: true } }))
        ?.timezone ?? null,

    /** Newest first. */
    async list(filter: AuditLogFilter, page: number, pageSize: number) {
      const exact = filter.actions?.filter((a) => !a.endsWith('.')) ?? [];
      const prefixes = filter.actions?.filter((a) => a.endsWith('.')) ?? [];
      const where: Prisma.AuditLogWhereInput = {
        ...(filter.actorId && { actorId: filter.actorId }),
        ...(filter.actions && {
          OR: [
            ...(exact.length > 0 ? [{ action: { in: exact } }] : []),
            ...prefixes.map((prefix) => ({ action: { startsWith: prefix } })),
          ],
        }),
        ...(filter.targetType && { targetType: filter.targetType }),
        ...(filter.targetId && { targetId: filter.targetId }),
        ...((filter.from || filter.to) && {
          createdAt: {
            ...(filter.from && { gte: filter.from }),
            ...(filter.to && { lt: filter.to }),
          },
        }),
      };
      const [items, total] = await prisma.$transaction([
        prisma.auditLog.findMany({
          where,
          include: { actor: { select: { id: true, name: true, email: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        prisma.auditLog.count({ where }),
      ]);
      return { items, total };
    },
  };
}

export type AuditRepository = ReturnType<typeof createAuditRepository>;
