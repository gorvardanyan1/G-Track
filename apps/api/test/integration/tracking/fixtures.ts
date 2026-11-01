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

export async function setTimesheet(
  userId: string,
  weekStart: string,
  status: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED',
) {
  await prisma().timesheet.upsert({
    where: { userId_weekStart: { userId, weekStart: new Date(`${weekStart}T00:00:00Z`) } },
    create: { userId, weekStart: new Date(`${weekStart}T00:00:00Z`), status },
    update: { status },
  });
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
