import type { TimeEntryResponse } from '@tempo/shared';
import type { EntryWithRefs } from './time-entries.repository.ts';

export const toTimeEntryResponse = (
  entry: EntryWithRefs,
  editable: boolean,
): TimeEntryResponse => ({
  id: entry.id,
  userId: entry.userId,
  projectId: entry.projectId,
  taskId: entry.taskId,
  description: entry.description,
  startedAt: entry.startedAt.toISOString(),
  endedAt: entry.endedAt?.toISOString() ?? null,
  durationSeconds: entry.durationSeconds,
  isBillable: entry.isBillable,
  source: entry.source,
  project: entry.project,
  task: entry.task,
  editable,
});
