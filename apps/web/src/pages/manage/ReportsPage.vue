<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  MAX_REPORT_RANGE_DAYS,
  todayInZone,
  type ReportOptionsResponse,
  type ReportResponse,
} from '@tempo/shared';
import { reportsApi, type ReportParams } from '../../api/reports.ts';
import { timesheetsApi } from '../../api/timesheets.ts';
import BarChart from '../../components/charts/BarChart.vue';
import DonutChart from '../../components/charts/DonutChart.vue';
import StatCard from '../../components/charts/StatCard.vue';
import ReportEntriesTable from '../../components/manage/ReportEntriesTable.vue';
import ReportFilters, { type ReportFilterValues } from '../../components/manage/ReportFilters.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import DataTable from '../../components/ui/DataTable.vue';
import EmptyState from '../../components/ui/EmptyState.vue';
import ProjectDot from '../../components/ui/ProjectDot.vue';
import SegmentedControl from '../../components/ui/SegmentedControl.vue';
import SkeletonBlock from '../../components/ui/SkeletonBlock.vue';
import ToggleSwitch from '../../components/ui/ToggleSwitch.vue';
import UserAvatar from '../../components/ui/UserAvatar.vue';
import {
  PERIOD_PRESETS,
  resolvePeriod,
  spanDays,
  type DateSpan,
  type PeriodPreset,
} from '../../lib/report-period.ts';
import { formatDay, formatDurationHm, money } from '../../lib/time.ts';
import { useAuthStore } from '../../stores/auth.ts';
import { useClockStore } from '../../stores/clock.ts';
import { useToastStore } from '../../stores/toasts.ts';

const auth = useAuthStore();
const clock = useClockStore();
const toasts = useToastStore();
const zone = computed(() => auth.user?.timezone ?? 'UTC');
const today = computed(() => todayInZone(zone.value, new Date(clock.serverNowMs)));
const isAdmin = computed(() => auth.role === 'SUPER_ADMIN');

const preset = ref<PeriodPreset | 'custom'>('week');
const custom = ref<DateSpan>({ from: today.value, to: today.value });
const range = ref<DateSpan | null>(null);
const filters = ref<ReportFilterValues>({
  projectId: null,
  taskId: null,
  userId: null,
  clientId: null,
  billable: 'all',
});
const round = ref(false);
const options = ref<ReportOptionsResponse | null>(null);
const report = ref<ReportResponse | null>(null);
const loading = ref(true);
const exporting = ref<'csv' | 'pdf' | null>(null);
const view = ref<'entries' | 'people' | 'tasks' | 'projects'>('entries');

onMounted(async () => {
  options.value = await reportsApi.options().catch((e: unknown) => {
    toasts.error(e, 'Could not load the filters');
    return null;
  });
});

const weekOf = async (date: string) => {
  const sheet = await timesheetsApi.mine(date);
  return { from: sheet.weekStart, to: sheet.weekEnd };
};
const rangeError = computed(() => {
  if (preset.value !== 'custom') return null;
  const { from, to } = custom.value;
  if (!from || !to) return 'Pick both dates';
  if (to < from) return 'The end date is before the start date';
  if (spanDays(custom.value) > MAX_REPORT_RANGE_DAYS)
    return `Reports cover at most ${MAX_REPORT_RANGE_DAYS} days`;
  return null;
});

const params = computed<ReportParams | null>(() => {
  if (!range.value) return null;
  const f = filters.value;
  return {
    ...range.value,
    ...(f.projectId && { projectId: [f.projectId] }),
    ...(f.taskId && { taskId: [f.taskId] }),
    ...(f.userId && { userId: [f.userId] }),
    ...(f.clientId && { clientId: [f.clientId] }),
    ...(f.billable !== 'all' && { billable: f.billable === 'billable' }),
    round: round.value,
  };
});

async function resolveRange(): Promise<void> {
  if (preset.value === 'custom') {
    if (!rangeError.value) range.value = { ...custom.value };
    return;
  }
  try {
    range.value = await resolvePeriod(preset.value, today.value, weekOf);
  } catch (e) {
    toasts.error(e, 'Could not work out the period');
  }
}
watch([preset, () => custom.value.from, () => custom.value.to], resolveRange, {
  immediate: true,
});

async function load(): Promise<void> {
  if (!params.value) return;
  loading.value = true;
  try {
    report.value = await reportsApi.summary(params.value);
  } catch (e) {
    toasts.error(e, 'Could not load the report');
  } finally {
    loading.value = false;
  }
}
watch(() => JSON.stringify(params.value), load);

async function download(format: 'csv' | 'pdf'): Promise<void> {
  if (!params.value) return;
  exporting.value = format;
  try {
    const { blob, filename } = await reportsApi.export(params.value, format);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (e) {
    toasts.error(e, 'Export failed');
  } finally {
    exporting.value = null;
  }
}

const long = computed(() => (report.value?.byDay.length ?? 0) > 14);
const bars = computed(() =>
  (report.value?.byDay ?? []).map((d) => ({
    key: d.date,
    label: long.value
      ? formatDay(d.date, { day: 'numeric' })
      : formatDay(d.date, { weekday: 'short' }),
    sublabel: long.value ? '' : formatDay(d.date, { day: 'numeric', month: 'short' }),
    seconds: d.seconds,
    highlight: d.date === today.value,
  })),
);
const segments = computed(() =>
  (report.value?.byProject ?? []).map((p) => ({
    key: p.project.id,
    label: p.project.name,
    color: p.project.color,
    seconds: p.seconds,
  })),
);
const billablePct = computed(() =>
  report.value && report.value.totals.seconds > 0
    ? Math.round((report.value.totals.billableSeconds / report.value.totals.seconds) * 100)
    : 0,
);
const share = (seconds: number) =>
  report.value && report.value.totals.seconds > 0
    ? `${Math.round((seconds / report.value.totals.seconds) * 100)}%`
    : '0%';
const hm = (s: number) => formatDurationHm(s);
const amount = (cents: number | null) => (cents === null ? '—' : money(cents));

const PERIODS = [...PERIOD_PRESETS, { value: 'custom', label: 'Custom' }] as const;
const VIEWS = [
  { value: 'entries', label: 'Entries' },
  { value: 'people', label: 'By worker' },
  { value: 'tasks', label: 'By task' },
  { value: 'projects', label: 'By project' },
] as const;
const totalsColumns = (first: string) => [
  { key: 'name', label: first },
  { key: 'share', label: 'Share', align: 'right' as const },
  { key: 'billable', label: 'Billable', align: 'right' as const },
  { key: 'time', label: 'Time', align: 'right' as const },
  { key: 'amount', label: 'Amount', align: 'right' as const },
];
</script>

<template>
  <div>
    <div class="mb-5 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Reports</h1>
        <p class="mt-1 text-sm text-muted">
          <template v-if="range"
            >{{ formatDay(range.from, { day: 'numeric', month: 'short', year: 'numeric' }) }} –
            {{ formatDay(range.to, { day: 'numeric', month: 'short', year: 'numeric' }) }} · days in
            {{ zone }} · {{ isAdmin ? 'all projects' : 'projects you manage' }}</template
          >
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <ToggleSwitch v-model="round">Rounded</ToggleSwitch>
        <BaseButton
          size="sm"
          icon="download"
          :loading="exporting === 'csv'"
          @click="download('csv')"
          >CSV</BaseButton
        >
        <BaseButton
          size="sm"
          icon="download"
          :loading="exporting === 'pdf'"
          @click="download('pdf')"
          >PDF</BaseButton
        >
      </div>
    </div>

    <section class="card mb-6 space-y-4 p-4">
      <div class="flex flex-wrap items-center gap-3">
        <SegmentedControl v-model="preset" :options="PERIODS" label="Period" />
        <template v-if="preset === 'custom'">
          <input
            v-model="custom.from"
            type="date"
            class="field h-9 w-40"
            aria-label="From"
            :max="custom.to"
          />
          <span class="text-faint">–</span>
          <input
            v-model="custom.to"
            type="date"
            class="field h-9 w-40"
            aria-label="To"
            :min="custom.from"
          />
          <span v-if="rangeError" class="text-[13px] text-danger" role="alert">{{
            rangeError
          }}</span>
        </template>
      </div>
      <ReportFilters v-model="filters" :options="options" :show-clients="isAdmin" />
    </section>

    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <template v-if="report">
        <StatCard
          label="Total time"
          icon="clock"
          :value="report.totals.seconds"
          :format="hm"
          :hint="
            report.rounding
              ? `Rounded to ${report.rounding.minutes} min · actual ${hm(report.totals.rawSeconds)}`
              : undefined
          "
        />
        <StatCard
          label="Billable time"
          icon="check-circle"
          :value="report.totals.billableSeconds"
          :format="hm"
          :hint="`${billablePct}% of the total`"
        />
        <StatCard
          label="Billable amount"
          icon="dollar"
          :value="report.totals.amountCents ?? 0"
          :format="(c) => (report?.totals.amountCents === null ? '—' : money(c))"
          hint="From each member’s hourly rate"
        />
        <StatCard
          label="Entries"
          icon="grid"
          :value="report.totals.entryCount"
          :format="(n) => String(n)"
          :hint="`${report.byUser.length} ${report.byUser.length === 1 ? 'person' : 'people'}`"
        />
      </template>
      <div v-for="i in report ? 0 : 4" v-else :key="i" class="card p-5">
        <SkeletonBlock width="50%" /><SkeletonBlock height="1.8rem" width="70%" class="mt-3" />
      </div>
    </div>

    <div v-if="report && report.totals.seconds === 0 && !loading" class="card mt-6">
      <EmptyState
        art="chart"
        title="No time matches these filters"
        description="Try a longer period or fewer filters."
      />
    </div>
    <div v-else class="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <section class="card p-5">
        <h2 class="mb-4 text-sm font-semibold text-ink">By day</h2>
        <BarChart v-if="report" :key="`${report.from}:${report.to}`" :data="bars" />
        <SkeletonBlock v-else height="220px" />
      </section>
      <section class="card p-5">
        <h2 class="mb-4 text-sm font-semibold text-ink">By project</h2>
        <DonutChart v-if="report" :segments="segments" />
        <SkeletonBlock v-else height="160px" />
      </section>

      <section class="card overflow-hidden lg:col-span-2">
        <header class="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <h2 class="text-sm font-semibold text-ink">Details</h2>
          <SegmentedControl v-model="view" :options="VIEWS" label="Breakdown" />
        </header>
        <ReportEntriesTable
          v-if="view === 'entries' && params"
          :params="params"
          :zone="zone"
          :show-amounts="true"
        />
        <DataTable
          v-else-if="view === 'people'"
          :columns="totalsColumns('Worker')"
          :rows="report?.byUser ?? []"
          :row-key="(r) => r.user.id"
          :loading="!report"
        >
          <template #name="{ row }"
            ><span class="flex items-center gap-2.5 text-ink"
              ><UserAvatar :name="row.user.name" :size="24" /> {{ row.user.name }}</span
            ></template
          >
          <template #share="{ row }"
            ><span class="num text-muted">{{ share(row.seconds) }}</span></template
          >
          <template #billable="{ row }"
            ><span class="num text-muted">{{ hm(row.billableSeconds) }}</span></template
          >
          <template #time="{ row }"
            ><span class="num font-medium text-ink">{{ hm(row.seconds) }}</span></template
          >
          <template #amount="{ row }"
            ><span class="num text-muted">{{ amount(row.amountCents) }}</span></template
          >
        </DataTable>
        <DataTable
          v-else-if="view === 'tasks'"
          :columns="totalsColumns('Task')"
          :rows="report?.byTask ?? []"
          :row-key="(r) => `${r.project.id}:${r.task?.id ?? ''}`"
          :loading="!report"
        >
          <template #name="{ row }"
            ><span class="flex items-center gap-2"
              ><ProjectDot :color="row.project.color" />
              <span :class="row.task ? 'text-ink' : 'text-faint'">{{
                row.task?.name ?? 'No task'
              }}</span>
              <span class="text-faint">· {{ row.project.name }}</span></span
            ></template
          >
          <template #share="{ row }"
            ><span class="num text-muted">{{ share(row.seconds) }}</span></template
          >
          <template #billable="{ row }"
            ><span class="num text-muted">{{ hm(row.billableSeconds) }}</span></template
          >
          <template #time="{ row }"
            ><span class="num font-medium text-ink">{{ hm(row.seconds) }}</span></template
          >
          <template #amount="{ row }"
            ><span class="num text-muted">{{ amount(row.amountCents) }}</span></template
          >
        </DataTable>
        <DataTable
          v-else
          :columns="totalsColumns('Project')"
          :rows="report?.byProject ?? []"
          :row-key="(r) => r.project.id"
          :loading="!report"
        >
          <template #name="{ row }"
            ><span class="flex items-center gap-2"
              ><ProjectDot :color="row.project.color" />
              <span class="text-ink">{{ row.project.name }}</span>
              <span v-if="row.project.clientName" class="text-faint"
                >· {{ row.project.clientName }}</span
              ></span
            ></template
          >
          <template #share="{ row }"
            ><span class="num text-muted">{{ share(row.seconds) }}</span></template
          >
          <template #billable="{ row }"
            ><span class="num text-muted">{{ hm(row.billableSeconds) }}</span></template
          >
          <template #time="{ row }"
            ><span class="num font-medium text-ink">{{ hm(row.seconds) }}</span></template
          >
          <template #amount="{ row }"
            ><span class="num text-muted">{{ amount(row.amountCents) }}</span></template
          >
        </DataTable>
      </section>
    </div>
  </div>
</template>
