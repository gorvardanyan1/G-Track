import type { ActivityEntry } from '@tempo/shared';
import type { EntryWithRefs } from '../time-entries/time-entries.repository.ts';

/** A running timer as PMs and admins see it: no rates, no amounts. */
export const toActivityEntry = (entry: EntryWithRefs): ActivityEntry => ({
  id: entry.id,
  project: entry.project,
  task: entry.task,
  description: entry.description,
  isBillable: entry.isBillable,
  startedAt: entry.startedAt.toISOString(),
});
