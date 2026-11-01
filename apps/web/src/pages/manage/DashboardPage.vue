<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { ProjectUsageListResponse, TimesheetSummary } from '@tempo/shared';
import { projectsApi } from '../../api/projects.ts';
import { timesheetsApi } from '../../api/timesheets.ts';
import StatCard from '../../components/charts/StatCard.vue';
import BudgetBar from '../../components/manage/BudgetBar.vue';
import WorkingNowList from '../../components/manage/WorkingNowList.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import EmptyState from '../../components/ui/EmptyState.vue';
import ProjectDot from '../../components/ui/ProjectDot.vue';
import SkeletonBlock from '../../components/ui/SkeletonBlock.vue';
import UserAvatar from '../../components/ui/UserAvatar.vue';
import { budgetUsage } from '../../lib/budget.ts';
import { liveExtraSeconds } from '../../lib/live-usage.ts';
import { formatDay, formatDurationHm, hoursLabel } from '../../lib/time.ts';
import { useActivityStore } from '../../stores/activity.ts';
import { useAuthStore } from '../../stores/auth.ts';
import { useClockStore } from '../../stores/clock.ts';
import { useRealtimeStore } from '../../stores/realtime.ts';
import { useToastStore } from '../../stores/toasts.ts';

const auth = useAuthStore();
const clock = useClockStore();
const activity = useActivityStore();
const realtime = useRealtimeStore();
const toasts = useToastStore();
const zone = computed(() => auth.user?.timezone ?? 'UTC');

const usage = ref<ProjectUsageListResponse | null>(null);
const fetchedAtMs = ref(0);
const pending = ref<{ items: TimesheetSummary[]; total: number } | null>(null);

async function loadUsage(): Promise<void> {
  try {
    const next = await projectsApi.usage();
    fetchedAtMs.value = clock.serverNowMs;
    usage.value = next;
  } catch (e) {
    toasts.error(e, 'Could not load budgets');
  }
}
async function loadPending(): Promise<void> {
  try {
    pending.value = await timesheetsApi.list({
      status: 'SUBMITTED',
      reviewable: true,
      pageSize: 5,
    });
  } catch (e) {
    toasts.error(e, 'Could not load approvals');
  }
}
onMounted(() => void Promise.all([loadUsage(), loadPending()]));

// When someone starts or stops, the totals change: reload them (debounced).
let reload: ReturnType<typeof setTimeout> | undefined;
watch(
  () => activity.items.map((i) => i.entry.id).join(),
  () => {
    clearTimeout(reload);
    reload = setTimeout(() => void loadUsage(), 1200);
  },
);
onBeforeUnmount(() => clearTimeout(reload));

/** Usage plus the running timers' time since the fetch, ticking every second. */
const projects = computed(() =>
  (usage.value?.items ?? []).map((item) => {
    const running = activity.onProject(item.project.id);
    const extra = liveExtraSeconds(
      running.map((r) => r.entry.startedAt),
      fetchedAtMs.value,
      clock.serverNowMs,
    );
    return {
      ...item,
      totalSeconds: item.totalSeconds + extra,
      weekSeconds: item.weekSeconds + extra,
      running: running.length,
    };
  }),
);
const weekTotal = computed(() => projects.value.reduce((a, p) => a + p.weekSeconds, 0));
const atRisk = computed(
  () =>
    projects.value.filter((p) =>
      ['warning', 'over'].includes(budgetUsage(p.totalSeconds, p.budgetHours).tone),
    ).length,
);
const weekLabel = computed(() =>
  usage.value
    ? `${formatDay(usage.value.week.from, { day: 'numeric', month: 'short' })} – ${formatDay(
        usage.value.week.to,
        { day: 'numeric', month: 'short' },
      )}`
    : '',
);
const greeting = computed(() => {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', timeZone: zone.value }).format(
      new Date(clock.serverNowMs),
    ),
  );
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
});
const firstName = computed(() => auth.user?.name.split(/\s+/)[0] ?? '');
const count = (n: number) => String(n);
const hm = (s: number) => formatDurationHm(s);
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight text-ink">
        {{ greeting }}, {{ firstName }}
      </h1>
      <p class="mt-1 text-sm text-muted">
        <template v-if="usage">Week of {{ weekLabel }} · {{ zone }}</template>
        <SkeletonBlock v-else width="180px" />
      </p>
    </div>

    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard
        label="Working now"
        icon="play"
        :value="activity.items.length"
        :format="count"
        :hint="realtime.status === 'online' ? 'Live' : 'Reconnecting…'"
      />
      <StatCard label="Tracked this week" icon="clock" :value="weekTotal" :format="hm" />
      <StatCard
        label="Pending approvals"
        icon="check-circle"
        :value="pending?.total ?? 0"
        :format="count"
      />
      <StatCard
        label="Budgets at risk"
        icon="alert"
        :value="atRisk"
        :format="count"
        hint="80 % or more used"
      />
    </div>

    <div class="mt-6 grid gap-6 lg:grid-cols-[1.25fr_1fr]">
      <section class="card overflow-hidden">
        <header class="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 class="flex items-center gap-2 text-sm font-semibold text-ink">
            <span class="relative flex size-2">
              <span
                v-if="activity.items.length"
                class="absolute inline-flex size-full animate-ping rounded-full bg-running opacity-60 motion-reduce:hidden"
              />
              <span class="relative inline-flex size-2 rounded-full bg-running" />
            </span>
            Working now
          </h2>
          <span class="text-xs text-faint">{{ activity.items.length }} tracking</span>
        </header>
        <WorkingNowList
          :items="activity.items"
          :loading="!activity.received && realtime.status !== 'offline'"
          :zone="zone"
        />
      </section>

      <section class="card overflow-hidden">
        <header class="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 class="text-sm font-semibold text-ink">Waiting for your approval</h2>
          <RouterLink
            to="/approvals"
            class="text-[13px] font-medium text-accent-ink hover:underline"
            >View all</RouterLink
          >
        </header>
        <ul v-if="!pending" class="divide-y divide-line">
          <li v-for="i in 3" :key="i" class="px-5 py-4"><SkeletonBlock width="70%" /></li>
        </ul>
        <p v-else-if="pending.items.length === 0" class="px-5 py-10 text-center text-sm text-faint">
          All caught up — no timesheets waiting.
        </p>
        <ul v-else class="divide-y divide-line">
          <li v-for="sheet in pending.items" :key="sheet.id ?? sheet.weekStart">
            <RouterLink
              :to="{ path: '/approvals', query: { review: sheet.id } }"
              class="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/60"
            >
              <UserAvatar :name="sheet.user.name" :size="28" />
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-ink">{{ sheet.user.name }}</p>
                <p class="text-xs text-faint">
                  Week of {{ formatDay(sheet.weekStart, { day: 'numeric', month: 'short' }) }}
                </p>
              </div>
              <span class="num text-sm text-muted">{{ hm(sheet.totalSeconds) }}</span>
            </RouterLink>
          </li>
        </ul>
      </section>

      <section class="card lg:col-span-2">
        <header class="flex items-center justify-between px-5 pt-5 pb-1">
          <div>
            <h2 class="text-sm font-semibold text-ink">Hours vs budget</h2>
            <p class="mt-0.5 text-xs text-faint">
              All time on each project; the darker part is this week.
            </p>
          </div>
          <BaseButton
            size="sm"
            variant="ghost"
            icon-right="chevron-right"
            @click="$router.push('/projects')"
            >Projects</BaseButton
          >
        </header>
        <div v-if="!usage" class="space-y-6 p-5">
          <div v-for="i in 3" :key="i">
            <SkeletonBlock width="30%" /><SkeletonBlock height="8px" class="mt-3" />
          </div>
        </div>
        <EmptyState
          v-else-if="projects.length === 0"
          art="compass"
          title="No projects to manage yet"
          description="Projects where you are the project manager appear here."
        />
        <ul v-else class="grid gap-x-10 gap-y-6 p-5 md:grid-cols-2">
          <li v-for="p in projects" :key="p.project.id">
            <RouterLink :to="`/projects/${p.project.id}`" class="group block">
              <div class="mb-2 flex items-center justify-between gap-3">
                <span class="flex min-w-0 items-center gap-2">
                  <ProjectDot :color="p.project.color" />
                  <span class="truncate text-sm font-medium text-ink group-hover:text-accent-ink">{{
                    p.project.name
                  }}</span>
                  <span v-if="p.project.clientName" class="truncate text-xs text-faint">{{
                    p.project.clientName
                  }}</span>
                </span>
                <span class="num shrink-0 text-xs text-muted"
                  >{{ hoursLabel(p.weekSeconds) }} this week<template v-if="p.running">
                    · <span class="text-running">{{ p.running }} live</span></template
                  ></span
                >
              </div>
              <BudgetBar
                :used-seconds="p.totalSeconds"
                :budget-hours="p.budgetHours"
                :highlight-seconds="p.weekSeconds"
              />
            </RouterLink>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>
