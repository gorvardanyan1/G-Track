<script setup lang="ts">
import { ref, watch } from 'vue';
import type { ReportEntriesResponse } from '@tempo/shared';
import { reportsApi, type ReportParams } from '../../api/reports.ts';
import { formatDay, formatDurationHm, money, timeOf } from '../../lib/time.ts';
import { useToastStore } from '../../stores/toasts.ts';
import DataTable from '../ui/DataTable.vue';
import PaginationBar from '../ui/PaginationBar.vue';
import ProjectDot from '../ui/ProjectDot.vue';

const props = defineProps<{ params: ReportParams; zone: string; showAmounts: boolean }>();
const toasts = useToastStore();
const PAGE_SIZE = 25;
const page = ref(1);
const data = ref<ReportEntriesResponse | null>(null);
const loading = ref(true);

async function load(): Promise<void> {
  loading.value = true;
  try {
    data.value = await reportsApi.entries(props.params, page.value, PAGE_SIZE);
  } catch (e) {
    toasts.error(e, 'Could not load the entries');
  } finally {
    loading.value = false;
  }
}
watch(
  () => JSON.stringify(props.params),
  () => {
    if (page.value === 1) void load();
    else page.value = 1;
  },
  { immediate: true },
);
watch(page, () => void load());

/** A day's part of an entry that runs to midnight ends at 24:00. */
const endLabel = (row: ReportEntriesResponse['items'][number]) => {
  const end = timeOf(row.end, props.zone);
  return end === '00:00' && row.end > row.start ? '24:00' : end;
};
const columns = [
  { key: 'date', label: 'Date' },
  { key: 'time', label: 'Time' },
  { key: 'user', label: 'Worker' },
  { key: 'project', label: 'Project' },
  { key: 'description', label: 'Description', class: 'max-w-64' },
  { key: 'duration', label: 'Duration', align: 'right' as const },
  ...(props.showAmounts ? [{ key: 'amount', label: 'Amount', align: 'right' as const }] : []),
];
</script>

<template>
  <div>
    <DataTable
      :columns="columns"
      :rows="data?.items ?? []"
      :row-key="(r) => r.key"
      :loading="loading && !data"
      :class="loading && data && 'opacity-60 transition-opacity'"
    >
      <template #date="{ row }"
        ><span class="whitespace-nowrap text-ink">{{ formatDay(row.date) }}</span></template
      >
      <template #time="{ row }"
        ><span class="num whitespace-nowrap text-muted"
          >{{ timeOf(row.start, zone) }}–{{ endLabel(row) }}</span
        ></template
      >
      <template #user="{ row }"
        ><span class="whitespace-nowrap text-ink">{{ row.user.name }}</span></template
      >
      <template #project="{ row }">
        <span class="flex items-center gap-2 whitespace-nowrap">
          <ProjectDot :color="row.project.color" />
          <span class="text-ink">{{ row.project.name }}</span>
          <span v-if="row.task" class="text-faint">· {{ row.task.name }}</span>
        </span>
      </template>
      <template #description="{ row }">
        <span
          class="block max-w-64 truncate"
          :class="row.description ? 'text-muted' : 'text-faint'"
          >{{ row.description || 'No description' }}</span
        >
      </template>
      <template #duration="{ row }">
        <span
          class="num font-medium whitespace-nowrap"
          :class="row.isBillable ? 'text-ink' : 'text-muted'"
          :title="
            [
              row.isBillable ? '' : 'Non-billable',
              row.seconds === row.rawSeconds ? '' : `Actual ${formatDurationHm(row.rawSeconds)}`,
            ]
              .filter(Boolean)
              .join(' · ') || undefined
          "
          >{{ formatDurationHm(row.seconds) }}</span
        >
      </template>
      <template #amount="{ row }"
        ><span class="num text-muted">{{
          row.amountCents === null || !row.isBillable ? '—' : money(row.amountCents)
        }}</span></template
      >
      <template #empty
        ><p class="px-5 py-10 text-center text-sm text-faint">No entries match.</p></template
      >
    </DataTable>
    <PaginationBar
      v-if="data && data.total > PAGE_SIZE"
      v-model="page"
      :total="data.total"
      :page-size="PAGE_SIZE"
      noun="rows"
    />
  </div>
</template>
