import { watch } from 'vue';
import { useRouter } from 'vue-router';
import { http } from '../api/client.ts';
import { tracksTime } from '../router/navigation.ts';
import { useActivityStore } from '../stores/activity.ts';
import { useAuthStore } from '../stores/auth.ts';
import { useClockStore } from '../stores/clock.ts';
import { useEntriesStore } from '../stores/entries.ts';
import { useProjectsStore } from '../stores/projects.ts';
import { useRealtimeStore } from '../stores/realtime.ts';
import { useTimerStore } from '../stores/timer.ts';
import { useTimesheetEventsStore } from '../stores/timesheet-events.ts';
import { useToastStore } from '../stores/toasts.ts';
import { formatDay } from '../lib/time.ts';

/**
 * Wires the app together once: api hooks (server clock, refreshed sessions, expiry), the live
 * connection and its events, and loading/clearing per-user state when the session changes.
 */
export function useSession(): void {
  const router = useRouter();
  const auth = useAuthStore();
  const clock = useClockStore();
  const realtime = useRealtimeStore();
  const timer = useTimerStore();
  const entries = useEntriesStore();
  const projects = useProjectsStore();
  const timesheets = useTimesheetEventsStore();
  const toasts = useToastStore();
  const activity = useActivityStore();

  http.onServerTime((sample) => clock.addSample(sample));
  http.onSession((session) => {
    if (auth.status === 'authenticated') auth.user = session.user;
  });
  http.onSessionExpired(() => {
    if (auth.status !== 'authenticated') return;
    auth.clear();
    toasts.info('Your session ended', 'Please sign in again.');
    void router.push({ path: '/login', query: { redirect: router.currentRoute.value.fullPath } });
  });

  realtime.on('entry:saved', ({ action, entry }) => {
    const wasRunning = timer.running?.id === entry.id;
    timer.applySaved(entry);
    if (action === 'auto_stopped' && wasRunning) {
      toasts.push(
        {
          tone: 'info',
          title: 'Your timer was stopped',
          message: 'It ran longer than the maximum your organization allows.',
        },
        10_000,
      );
    }
  });
  realtime.on('entry:deleted', ({ id }) => timer.applyDeleted(id));
  realtime.on('activity:snapshot', (event) => activity.applySnapshot(event));
  realtime.on('activity:update', (event) => activity.applyUpdate(event));
  realtime.on('timesheet:changed', (event) => {
    timesheets.push(event);
    const week = formatDay(event.weekStart, { day: 'numeric', month: 'short' });
    if (event.status === 'APPROVED') toasts.success('Timesheet approved', `Week of ${week}`);
    if (event.status === 'REJECTED')
      toasts.info('Timesheet returned', `Week of ${week} needs changes.`);
  });

  watch(
    () => auth.status,
    (status) => {
      if (status === 'authenticated') {
        clock.start();
        realtime.connect();
        void projects.load().catch(() => undefined);
        if (tracksTime(auth.role)) void timer.load().catch(() => undefined);
      } else if (status === 'anonymous') {
        realtime.disconnect();
        timer.reset();
        entries.reset();
        projects.reset();
        activity.reset();
      }
    },
    { immediate: true },
  );
}
