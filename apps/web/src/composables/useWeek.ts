import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { addDays, todayInZone, type TimesheetResponse } from '@tempo/shared';
import { timesheetsApi } from '../api/timesheets.ts';
import { useAuthStore } from '../stores/auth.ts';
import { useClockStore } from '../stores/clock.ts';
import { useEntriesStore } from '../stores/entries.ts';
import { useTimesheetEventsStore } from '../stores/timesheet-events.ts';

/**
 * The user's week (from the api, so it follows the org's week start day) and its timesheet.
 * Reloads when entries change or the server reports a status change for the week.
 */
export function useWeek() {
  const auth = useAuthStore();
  const clock = useClockStore();
  const entries = useEntriesStore();
  const events = useTimesheetEventsStore();

  const zone = computed(() => auth.user?.timezone ?? 'UTC');
  const today = computed(() => todayInZone(zone.value, new Date(clock.serverNowMs)));
  const anchor = ref(today.value);
  const sheet = ref<TimesheetResponse | null>(null);
  const loading = ref(true);
  const error = ref<unknown>(null);
  let request = 0;

  async function load(): Promise<void> {
    const id = ++request;
    try {
      const result = await timesheetsApi.mine(anchor.value);
      if (id === request) {
        sheet.value = result;
        error.value = null;
      }
    } catch (e) {
      if (id === request) error.value = e;
    } finally {
      if (id === request) loading.value = false;
    }
  }

  watch(
    anchor,
    () => {
      loading.value = true;
      void load();
    },
    { immediate: true },
  );

  // Debounced: a burst of entry changes (timer stop + start) reloads once.
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(
    () => entries.version,
    () => {
      clearTimeout(timer);
      timer = setTimeout(() => void load(), 400);
    },
  );
  watch(
    () => events.last,
    (event) => {
      if (event && event.weekStart === sheet.value?.weekStart) void load();
    },
  );
  onBeforeUnmount(() => clearTimeout(timer));

  return {
    zone,
    today,
    sheet,
    loading,
    error,
    reload: load,
    isCurrent: computed(() => sheet.value !== null && sheet.value.dates.includes(today.value)),
    previous: () => (anchor.value = addDays(sheet.value?.weekStart ?? anchor.value, -7)),
    next: () => (anchor.value = addDays(sheet.value?.weekStart ?? anchor.value, 7)),
    current: () => (anchor.value = today.value),
  };
}
