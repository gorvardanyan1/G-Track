import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { TimesheetChangedEvent } from '@tempo/shared';

/** Timesheet status changes pushed by the server; pages showing a week reload on them. */
export const useTimesheetEventsStore = defineStore('timesheet-events', () => {
  const last = ref<TimesheetChangedEvent | null>(null);
  return { last, push: (event: TimesheetChangedEvent) => (last.value = event) };
});
