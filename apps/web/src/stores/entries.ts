import { defineStore } from 'pinia';
import { ref } from 'vue';
import type {
  CreateTimeEntryRequest,
  TimeEntryResponse,
  UpdateTimeEntryRequest,
} from '@tempo/shared';
import { trackingApi } from '../api/tracking.ts';

/**
 * The user's own time entries by id. Pages load date ranges; socket events and local actions
 * keep the same objects up to date, so every view and tab agrees.
 */
export const useEntriesStore = defineStore('entries', () => {
  const byId = ref<Record<string, TimeEntryResponse>>({});
  /** Bumped whenever entries change, for views that recompute derived data. */
  const version = ref(0);

  function upsert(entry: TimeEntryResponse): void {
    byId.value = { ...byId.value, [entry.id]: entry };
    version.value++;
  }

  function forget(id: string): void {
    if (!(id in byId.value)) return;
    const { [id]: _removed, ...rest } = byId.value;
    byId.value = rest;
    version.value++;
  }

  return {
    byId,
    version,
    upsert,
    forget,

    /** Loads entries overlapping local dates [from, to]; drops ones deleted meanwhile. */
    async loadRange(from: string, to: string, range: { start: Date; end: Date }) {
      const list = await trackingApi.listEntries(from, to);
      const next = { ...byId.value };
      for (const entry of Object.values(next)) {
        const end = entry.endedAt ? new Date(entry.endedAt) : new Date(8.64e15);
        if (new Date(entry.startedAt) < range.end && end > range.start) delete next[entry.id];
      }
      for (const entry of list) next[entry.id] = entry;
      byId.value = next;
      version.value++;
      return list;
    },

    async create(input: CreateTimeEntryRequest) {
      const entry = await trackingApi.createEntry(input);
      upsert(entry);
      return entry;
    },

    async update(id: string, input: UpdateTimeEntryRequest) {
      const entry = await trackingApi.updateEntry(id, input);
      upsert(entry);
      return entry;
    },

    async remove(id: string) {
      await trackingApi.deleteEntry(id);
      forget(id);
    },

    async duplicate(id: string, date?: string) {
      const entry = await trackingApi.duplicateEntry(id, date);
      upsert(entry);
      return entry;
    },

    reset: () => {
      byId.value = {};
      version.value++;
    },
  };
});
