<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { todayInZone, type ReportResponse } from '@tempo/shared';
import { reportsApi } from '../../api/reports.ts';
import { timesheetsApi } from '../../api/timesheets.ts';
import BarChart from '../../components/charts/BarChart.vue';
import DonutChart from '../../components/charts/DonutChart.vue';
import StatCard from '../../components/charts/StatCard.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import DataTable from '../../components/ui/DataTable.vue';
import EmptyState from '../../components/ui/EmptyState.vue';
import ProjectDot from '../../components/ui/ProjectDot.vue';
import SegmentedControl from '../../components/ui/SegmentedControl.vue';
import SkeletonBlock from '../../components/ui/SkeletonBlock.vue';
import ToggleSwitch from '../../components/ui/ToggleSwitch.vue';
import { PERIOD_PRESETS, resolvePeriod, type PeriodPreset } from '../../lib/report-period.ts';
import { formatDay, formatDurationHm } from '../../lib/time.ts';
import { useAuthStore } from '../../stores/auth.ts';
import { useClockStore } from '../../stores/clock.ts';
import { useToastStore } from '../../stores/toasts.ts';

const auth = useAuthStore();
const clock = useClockStore();
const toasts = useToastStore();
const zone = computed(() => auth.user?.timezone ?? 'UTC');
const today = computed(() => todayInZone(zone.value, new Date(clock.serverNowMs)));

const preset = ref<PeriodPreset>('week');
const round = ref(false);
const range = ref<{ from: string; to: string } | null>(null);
const report = ref<ReportResponse | null>(null);
const loading = ref(true);
const exporting = ref<'csv' | 'pdf' | null>(null);

/** Week boundaries come from the api (the org's week start day). */
const weekOf = async (date: string) => {
  const sheet = await timesheetsApi.mine(date);
  return { from: sheet.weekStart, to: sheet.weekEnd };
};

async function load(): Promise<void> {
  loading.value = true;
  try {
    range.value = await resolvePeriod(preset.value, today.value, weekOf);
    report.value = await reportsApi.summary({ ...range.value, round: round.value });
  } catch (e) {
    toasts.error(e, 'Could not load the report');
  } finally {
    loading.value = false;
  }
}
watch([preset, round], () => void load(), { immediate: true });

const bars = computed(() =>
  (report.value?.byDay ?? []).map((d) => ({
    key: d.date,
    label:
      report.value && report.value.byDay.length > 10
        ? formatDay(d.date, { day: 'numeric' })
        : formatDay(d.date, { weekday: 'short' }),
    sublabel:
      report.value && report.value.byDay.length > 10
        ? ''
        : formatDay(d.date, { day: 'numeric', month: 'short' }),
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
const activeDays = computed(() => report.value?.byDay.filter((d) => d.seconds > 0).length ?? 0);
const billablePct = computed(() =>
  report.value && report.value.totals.seconds > 0
    ? Math.round((report.value.totals.billableSeconds / report.value.totals.seconds) * 100)
    : 0,
);
const hm = (s: number) => formatDurationHm(s);

async function download(format: 'csv' | 'pdf'): Promise<void> {
  if (!range.value) return;
  exporting.value = format;
  try {
    const { blob, filename } = await reportsApi.export(
      { ...range.value, round: round.value },
      format,
    );
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

const taskColumns = [
  { key: 'task', label: 'Task' },
  { key: 'project', label: 'Project' },
  { key: 'time', label: 'Time', align: 'right' as const },
];
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">My reports</h1>
        <p v-if="range" class="mt-1 text-sm text-muted">
          {{ formatDay(range.from, { day: 'numeric', month: 'short' }) }} –
          {{ formatDay(range.to, { day: 'numeric', month: 'short', year: 'numeric' }) }} · days in
          {{ zone }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <SegmentedControl v-model="preset" :options="PERIOD_PRESETS" label="Period" />
        <ToggleSwitch
          v-model="round"
          :title="'Rounds each entry by your organization’s rule — display only'"
          >Rounded</ToggleSwitch
        >
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

    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <template v-if="report">
        <StatCard
          label="Total time"
          icon="clock"
          :value="report.totals.seconds"
          :format="hm"
          :hint="round && report.rounding ? `Rounded to ${report.rounding.minutes} min` : undefined"
        />
        <StatCard
          label="Billable"
          icon="dollar"
          :value="report.totals.billableSeconds"
          :format="hm"
          :hint="`${billablePct}% of your time`"
        />
        <StatCard
          label="Daily average"
          icon="chart"
          :value="activeDays ? Math.round(report.totals.seconds / activeDays) : 0"
          :format="hm"
          :hint="`${activeDays} active ${activeDays === 1 ? 'day' : 'days'}`"
        />
        <StatCard
          label="Entries"
          icon="grid"
          :value="report.totals.entryCount"
          :format="(n) => String(n)"
        />
      </template>
      <div v-for="i in report ? 0 : 4" v-else :key="i" class="card p-5">
        <SkeletonBlock width="50%" /><SkeletonBlock height="1.8rem" width="70%" class="mt-3" />
      </div>
    </div>

    <div v-if="report && report.totals.seconds === 0 && !loading" class="card mt-6">
      <EmptyState
        art="chart"
        title="No time in this period"
        description="Track some time and your charts appear here."
      />
    </div>
    <div v-else class="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
      <section class="card p-5">
        <h2 class="mb-4 text-sm font-semibold text-ink">By day</h2>
        <BarChart v-if="report" :data="bars" />
        <SkeletonBlock v-else height="220px" />
      </section>
      <section class="card p-5">
        <h2 class="mb-4 text-sm font-semibold text-ink">By project</h2>
        <DonutChart v-if="report" :segments="segments" />
        <SkeletonBlock v-else height="160px" />
      </section>
      <section class="card lg:col-span-2">
        <h2 class="px-5 pt-5 pb-2 text-sm font-semibold text-ink">By task</h2>
        <DataTable
          :columns="taskColumns"
          :rows="report?.byTask ?? []"
          :row-key="(r) => `${r.project.id}:${r.task?.id ?? ''}`"
          :loading="!report"
        >
          <template #task="{ row }"
            ><span :class="row.task ? 'text-ink' : 'text-faint'">{{
              row.task?.name ?? 'No task'
            }}</span></template
          >
          <template #project="{ row }"
            ><span class="flex items-center gap-2 text-muted"
              ><ProjectDot :color="row.project.color" /> {{ row.project.name }}</span
            ></template
          >
          <template #time="{ row }"
            ><span class="num font-medium text-ink">{{ hm(row.seconds) }}</span></template
          >
        </DataTable>
      </section>
    </div>
  </div>
</template>
