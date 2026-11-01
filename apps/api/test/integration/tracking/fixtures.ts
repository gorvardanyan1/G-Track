import { addDays, startOfLocalDay } from '@tempo/shared';
import { prisma } from '../auth/harness.ts';

export async function setTimezone(userId: string, timezone: string): Promise<void> {
  await prisma().user.update({ where: { id: userId }, data: { timezone } });
}

export async function setOrgSettings(data: {
  lockAfterDays?: number | null;
  maxTimerDurationSeconds?: number;
  weekStartDay?: number;
  roundingMinutes?: number;
  roundingMode?: 'NEAREST' | 'UP' | 'DOWN';
  timesheetApprovalEnabled?: boolean;
}) {
  await prisma().orgSettings.upsert({
    where: { id: 1 },
    create: { id: 1, name: 'Test Org', defaultTimezone: 'UTC', ...data },
    update: data,
  });
}

/**
 * A timesheet in a given state, like the api leaves it: the period fixed in the owner's
 * timezone, and one whole-week review part with the matching status.
 */
export async function setTimesheet(
  userId: string,
  weekStart: string,
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED',
) {
  const { timezone } = await prisma().user.findUniqueOrThrow({ where: { id: userId } });
  const fixed =
    status === 'DRAFT'
      ? {}
      : {
          timezone,
          periodStart: startOfLocalDay(weekStart, timezone),
          periodEnd: startOfLocalDay(addDays(weekStart, 7), timezone),
        };
  const sheet = await prisma().timesheet.upsert({
    where: { userId_weekStart: { userId, weekStart: new Date(`${weekStart}T00:00:00Z`) } },
    create: { userId, weekStart: new Date(`${weekStart}T00:00:00Z`), status, ...fixed },
    update: { status, ...fixed },
  });
  await prisma().timesheetReview.deleteMany({ where: { timesheetId: sheet.id } });
  if (status !== 'DRAFT') {
    await prisma().timesheetReview.create({
      data: {
        timesheetId: sheet.id,
        projectId: null,
        seconds: 0,
        status: status === 'SUBMITTED' ? 'PENDING' : status,
      },
    });
  }
  return sheet;
}

export async function insertEntry(data: {
  userId: string;
  projectId: string;
  startedAt: string;
  endedAt: string | null;
  source?: 'TIMER' | 'MANUAL';
  taskId?: string | null;
  isBillable?: boolean;
  description?: string;
}) {
  return prisma().timeEntry.create({
    data: {
      userId: data.userId,
      projectId: data.projectId,
      startedAt: new Date(data.startedAt),
      endedAt: data.endedAt ? new Date(data.endedAt) : null,
      source: data.source ?? 'MANUAL',
      taskId: data.taskId ?? null,
      isBillable: data.isBillable ?? true,
      description: data.description ?? '',
    },
  });
}

export const errorBody = (res: { body: unknown }) =>
  (res.body as { error: { code: string; message: string; details?: unknown } }).error;
