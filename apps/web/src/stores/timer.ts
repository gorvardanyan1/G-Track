import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { TimeEntryResponse } from '@tempo/shared';
import { trackingApi } from '../api/tracking.ts';
import { useClockStore } from './clock.ts';
import { useEntriesStore } from './entries.ts';

export interface TimerDraft {
  description: string;
  projectId: string | null;
  taskId: string | null;
  /** null = the project's default. */
  isBillable: boolean | null;
}

const emptyDraft = (): TimerDraft => ({
  description: '',
  projectId: null,
  taskId: null,
  isBillable: null,
});

/**
 * The running timer. Start and stop happen on the server (server time); the display is
 * server-now − startedAt using the clock offset, so a wrong device clock doesn't matter.
 */
export const useTimerStore = defineStore('timer', () => {
  const clock = useClockStore();
  const entries = useEntriesStore();
  const running = ref<TimeEntryResponse | null>(null);
  const draft = ref<TimerDraft>(emptyDraft());
  const busy = ref(false);
  const loaded = ref(false);

  const elapsed = computed(() => (running.value ? clock.elapsed(running.value.startedAt) : 0));

  /** A saved entry from anywhere (this tab, another tab, the auto-stop job). */
  function applySaved(entry: TimeEntryResponse): void {
    entries.upsert(entry);
    if (entry.endedAt === null) {
      running.value = entry;
      draft.value = {
        description: entry.description,
        projectId: entry.projectId,
        taskId: entry.taskId,
        isBillable: entry.isBillable,
      };
    } else if (running.value?.id === entry.id) {
      running.value = null;
      draft.value = emptyDraft();
    }
  }

  function applyDeleted(id: string): void {
    entries.forget(id);
    if (running.value?.id === id) {
      running.value = null;
      draft.value = emptyDraft();
    }
  }

  async function load(): Promise<void> {
    const { entry } = await trackingApi.currentTimer();
    running.value = null;
    if (entry) applySaved(entry);
    loaded.value = true;
  }

  async function start(input: TimerDraft = draft.value): Promise<void> {
    if (!input.projectId) throw new Error('Pick a project first');
    busy.value = true;
    try {
      const previous = running.value;
      const { entry } = await trackingApi.startTimer({
        projectId: input.projectId,
        taskId: input.taskId,
        description: input.description.trim(),
        ...(input.isBillable !== null && { isBillable: input.isBillable }),
      });
      // The previous timer was stopped on the server; its final state arrives via the socket.
      if (previous) running.value = null;
      if (entry) applySaved(entry);
    } finally {
      busy.value = false;
    }
  }

  async function stop(): Promise<void> {
    busy.value = true;
    try {
      const { entry } = await trackingApi.stopTimer();
      if (entry) applySaved(entry);
    } finally {
      busy.value = false;
    }
  }

  return {
    running,
    draft,
    busy,
    loaded,
    elapsed,
    load,
    start,
    stop,
    applySaved,
    applyDeleted,
    /** Starts a new timer with a past entry's project, task, description and billable flag. */
    continueEntry: (entry: TimeEntryResponse) =>
      start({
        description: entry.description,
        projectId: entry.projectId,
        taskId: entry.taskId,
        isBillable: entry.isBillable,
      }),
    reset: () => {
      running.value = null;
      draft.value = emptyDraft();
      loaded.value = false;
    },
  };
});
