import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ActivityEntry, ActivitySnapshotEvent, ActivityUpdateEvent } from '@tempo/shared';

export interface WorkingNow {
  user: { id: string; name: string };
  entry: ActivityEntry;
}

/**
 * Who is tracking right now, as the server lets this PM or admin see it. The server sends a
 * snapshot on (re)connect and an update whenever someone starts, switches or stops.
 */
export const useActivityStore = defineStore('activity', () => {
  const byUser = ref<Record<string, WorkingNow>>({});
  /** False until the first snapshot arrives (the list shows skeletons until then). */
  const received = ref(false);

  function applySnapshot(event: ActivitySnapshotEvent): void {
    byUser.value = Object.fromEntries(event.items.map((item) => [item.user.id, item]));
    received.value = true;
  }

  function applyUpdate(event: ActivityUpdateEvent): void {
    const next = { ...byUser.value };
    if (event.running) next[event.user.id] = { user: event.user, entry: event.running };
    else delete next[event.user.id];
    byUser.value = next;
  }

  /** Longest-running first. */
  const items = computed(() =>
    Object.values(byUser.value).sort(
      (a, b) =>
        a.entry.startedAt.localeCompare(b.entry.startedAt) ||
        a.user.name.localeCompare(b.user.name),
    ),
  );

  return {
    items,
    received,
    applySnapshot,
    applyUpdate,
    /** Running timers on one project. */
    onProject: (projectId: string) => items.value.filter((i) => i.entry.project.id === projectId),
    reset: () => {
      byUser.value = {};
      received.value = false;
    },
  };
});
