<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { TimesheetStatus, TimesheetSummary } from '@tempo/shared';
import { timesheetsApi } from '../../api/timesheets.ts';
import TimesheetReviewModal from '../../components/manage/TimesheetReviewModal.vue';
import { TIMESHEET_STATUS } from '../../components/manage/timesheet-status.ts';
import BaseButton from '../../components/ui/BaseButton.vue';
import DataTable from '../../components/ui/DataTable.vue';
import EmptyState from '../../components/ui/EmptyState.vue';
import PaginationBar from '../../components/ui/PaginationBar.vue';
import SegmentedControl from '../../components/ui/SegmentedControl.vue';
import StatusBadge from '../../components/ui/StatusBadge.vue';
import UserAvatar from '../../components/ui/UserAvatar.vue';
import { formatDay, formatDurationHm } from '../../lib/time.ts';
import { useAuthStore } from '../../stores/auth.ts';
import { useToastStore } from '../../stores/toasts.ts';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const toasts = useToastStore();
const PAGE_SIZE = 20;

type Tab = 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'all';
const tab = ref<Tab>('SUBMITTED');
const page = ref(1);
const data = ref<{ items: TimesheetSummary[]; total: number } | null>(null);
const loading = ref(true);

async function load(): Promise<void> {
  loading.value = true;
  try {
    data.value = await timesheetsApi.list({
      reviewable: true,
      ...(tab.value !== 'all' && { status: tab.value as TimesheetStatus }),
      page: page.value,
      pageSize: PAGE_SIZE,
    });
  } catch (e) {
    toasts.error(e, 'Could not load timesheets');
  } finally {
    loading.value = false;
  }
}
watch(tab, () => (page.value === 1 ? void load() : (page.value = 1)));
watch(page, load, { immediate: true });

/** ?review=<id> opens a timesheet (links from the dashboard). */
const reviewing = computed(() =>
  typeof route.query['review'] === 'string' ? route.query['review'] : null,
);
const openReview = (id: string | null) =>
  router.replace({ query: id ? { ...route.query, review: id } : {} });
function reviewed(): void {
  void openReview(null);
  void load();
}

const zone = computed(() => auth.user?.timezone ?? 'UTC');
const submittedAt = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: zone.value,
      }).format(new Date(iso))
    : '—';
const TABS = [
  { value: 'SUBMITTED', label: 'Pending' },
  { value: 'REJECTED', label: 'Returned' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'all', label: 'All' },
] as const;
const columns = [
  { key: 'person', label: 'Person' },
  { key: 'week', label: 'Week' },
  { key: 'total', label: 'Total', align: 'right' as const },
  { key: 'submitted', label: 'Submitted' },
  { key: 'status', label: 'Status' },
  { key: 'actions', label: '', align: 'right' as const },
];
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Approvals</h1>
        <p class="mt-1 text-sm text-muted">
          Weekly timesheets from people on
          {{ auth.role === 'SUPER_ADMIN' ? 'every project' : 'the projects you manage' }}.
        </p>
      </div>
      <SegmentedControl v-model="tab" :options="TABS" label="Status" />
    </div>

    <section class="card overflow-hidden">
      <DataTable
        :columns="columns"
        :rows="data?.items ?? []"
        :row-key="(r) => r.id ?? `${r.user.id}:${r.weekStart}`"
        :loading="loading && !data"
      >
        <template #person="{ row }">
          <span class="flex items-center gap-3">
            <UserAvatar :name="row.user.name" :size="28" />
            <span class="font-medium whitespace-nowrap text-ink">{{ row.user.name }}</span>
          </span>
        </template>
        <template #week="{ row }">
          <span class="whitespace-nowrap text-muted"
            >{{ formatDay(row.weekStart, { day: 'numeric', month: 'short' }) }} –
            {{ formatDay(row.weekEnd, { day: 'numeric', month: 'short', year: 'numeric' }) }}</span
          >
        </template>
        <template #total="{ row }"
          ><span class="num font-medium text-ink">{{
            formatDurationHm(row.totalSeconds)
          }}</span></template
        >
        <template #submitted="{ row }"
          ><span class="whitespace-nowrap text-muted">{{
            submittedAt(row.submittedAt)
          }}</span></template
        >
        <template #status="{ row }">
          <StatusBadge :tone="TIMESHEET_STATUS[row.status].tone" dot>{{
            TIMESHEET_STATUS[row.status].label
          }}</StatusBadge>
        </template>
        <template #actions="{ row }">
          <BaseButton
            v-if="row.id"
            size="sm"
            :variant="row.status === 'SUBMITTED' ? 'primary' : 'ghost'"
            @click="openReview(row.id)"
            >{{ row.status === 'SUBMITTED' ? 'Review' : 'View' }}</BaseButton
          >
        </template>
        <template #empty>
          <EmptyState
            art="calendar"
            :title="tab === 'SUBMITTED' ? 'All caught up' : 'Nothing here yet'"
            :description="
              tab === 'SUBMITTED'
                ? 'Submitted timesheets wait here for your review.'
                : 'Reviewed timesheets show up here.'
            "
          />
        </template>
      </DataTable>
      <PaginationBar
        v-if="data && data.total > PAGE_SIZE"
        v-model="page"
        :total="data.total"
        :page-size="PAGE_SIZE"
        noun="timesheets"
      />
    </section>

    <TimesheetReviewModal
      :timesheet-id="reviewing"
      @close="openReview(null)"
      @reviewed="reviewed"
    />
  </div>
</template>
