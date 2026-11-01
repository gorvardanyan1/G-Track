import type { PrismaClient } from '../../db/prisma.ts';
import { Prisma } from '../../generated/prisma/client.ts';

export interface UsageRow {
  projectId: string;
  userId: string;
  userName: string;
  totalSeconds: number;
  weekSeconds: number;
}

/** Tracked time per (project, user): all time, and the part inside [weekStart, weekEnd). */
export function createProjectUsageRepository(prisma: PrismaClient) {
  return {
    async usage(projectIds: string[], week: { start: Date; end: Date }, now: Date) {
      if (projectIds.length === 0) return [];
      // A running timer counts up to `now`. Week time is each entry clipped to the week.
      const rows = await prisma.$queryRaw<
        { project_id: string; user_id: string; name: string; total: bigint; week: bigint }[]
      >`
        SELECT e.project_id, e.user_id, u.name,
          COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM
            (COALESCE(e.ended_at, ${now}::timestamptz) - e.started_at)))), 0)::bigint AS total,
          COALESCE(SUM(GREATEST(0, EXTRACT(EPOCH FROM
            (LEAST(COALESCE(e.ended_at, ${now}::timestamptz), ${week.end}::timestamptz)
              - GREATEST(e.started_at, ${week.start}::timestamptz))))), 0)::bigint AS week
        FROM time_entries e
        JOIN users u ON u.id = e.user_id
        WHERE e.project_id IN (${Prisma.join(projectIds.map((id) => Prisma.sql`${id}::uuid`))})
          AND e.started_at < ${now}::timestamptz
        GROUP BY e.project_id, e.user_id, u.name
        ORDER BY u.name, e.user_id`;
      return rows.map((r): UsageRow => ({
        projectId: r.project_id,
        userId: r.user_id,
        userName: r.name,
        totalSeconds: Number(r.total),
        weekSeconds: Number(r.week),
      }));
    },

    findViewer: (id: string) =>
      prisma.user.findUnique({ where: { id }, select: { timezone: true } }),
  };
}

export type ProjectUsageRepository = ReturnType<typeof createProjectUsageRepository>;
