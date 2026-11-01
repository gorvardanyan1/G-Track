<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { AuditLogResponse } from '@tempo/shared';
import { auditApi, type AuditListParams } from '../../api/audit.ts';
import { usersApi } from '../../api/users.ts';
import AuditDiff from '../../components/admin/AuditDiff.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import BaseModal from '../../components/ui/BaseModal.vue';
import DataTable from '../../components/ui/DataTable.vue';
import EmptyState from '../../components/ui/EmptyState.vue';
import PaginationBar from '../../components/ui/PaginationBar.vue';
import SearchSelect, { type SelectOption } from '../../components/ui/SearchSelect.vue';
import StatusBadge from '../../components/ui/StatusBadge.vue';
import UserAvatar from '../../components/ui/UserAvatar.vue';
import { auditActionGroups, auditActionLabel } from '../../lib/audit-diff.ts';
import { useAuthStore } from '../../stores/auth.ts';
import { useToastStore } from '../../stores/toasts.ts';

const auth = useAuthStore();
const toasts = useToastStore();
const zone = computed(() => auth.user?.timezone ?? 'UTC');
const PAGE_SIZE = 30;
const ALL = '*';

const action = ref<string>(ALL);
const actorId = ref<string>(ALL);
const from = ref('');
const to = ref('');
const page = ref(1);
const data = ref<{ items: AuditLogResponse[]; total: number } | null>(null);
const loading = ref(true);
const selected = ref<AuditLogResponse | null>(null);
const actionOptions = ref<SelectOption[]>([{ value: ALL, label: 'All actions' }]);
const actorOptions = ref<SelectOption[]>([{ value: ALL, label: 'Anyone' }]);

onMounted(async () => {
  const [actions, users] = await Promise.all([
    auditApi.actions().catch(() => []),
    usersApi.list({ status: 'all', pageSize: 100 }).catch(() => null),
  ]);
  actionOptions.value = [
    { value: ALL, label: 'All actions' },
    ...auditActionGroups(actions).flatMap(({ prefix, actions: list }) => {
      const group = auditActionLabel(prefix.slice(0, -1));
      return [
        { value: prefix, label: `All ${group.toLowerCase()} events`, group },
        ...list.map((a) => ({
          value: a,
          label: auditActionLabel(a),
          group,
          indent: true,
          keywords: a,
        })),
      ];
    }),
  ];
  actorOptions.value = [
    { value: ALL, label: 'Anyone' },
    ...(users?.items ?? []).map((u) => ({ value: u.id, label: u.name, keywords: u.email })),
  ];
});

const params = computed<AuditListParams>(() => ({
  ...(action.value !== ALL && { action: [action.value] }),
  ...(actorId.value !== ALL && { actorId: actorId.value }),
  ...(from.value && { from: from.value }),
  ...(to.value && { to: to.value }),
}));
const rangeError = computed(() =>
  from.value && to.value && to.value < from.value ? 'The end date is before the start date' : null,
);

async function load(): Promise<void> {
  if (rangeError.value) return;
  loading.value = true;
  try {
    data.value = await auditApi.list({ ...params.value, page: page.value, pageSize: PAGE_SIZE });
  } catch (e) {
    toasts.error(e, 'Could not load the audit log');
  } finally {
    loading.value = false;
  }
}
watch(page, load, { immediate: true });
watch(
  () => JSON.stringify(params.value),
  () => (page.value === 1 ? void load() : (page.value = 1)),
);
function clear(): void {
  action.value = actorId.value = ALL;
  from.value = to.value = '';
}

const when = (iso: string, style: 'short' | 'long' = 'short') =>
  new Intl.DateTimeFormat(undefined, {
    day: 'numeric',
    month: 'short',
    ...(style === 'long' && { year: 'numeric', weekday: 'short' }),
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    timeZone: zone.value,
  }).format(new Date(iso));
const tone = (a: string) =>
  /failed|reuse|locked|deleted|deactivated|revoked|rejected/.test(a)
    ? 'danger'
    : /created|accepted|approved|activated|enabled|added/.test(a)
      ? 'success'
      : a.startsWith('auth.')
        ? 'neutral'
        : 'accent';
const hasDiff = (row: AuditLogResponse) =>
  (row.before ?? null) !== null || (row.after ?? null) !== null;
const filtered = computed(() => Object.keys(params.value).length > 0);
const columns = [
  { key: 'when', label: 'When' },
  { key: 'actor', label: 'Who' },
  { key: 'action', label: 'Action' },
  { key: 'target', label: 'Target' },
  { key: 'ip', label: 'IP address' },
  { key: 'open', label: '', align: 'right' as const },
];
</script>

<template>
  <div>
    <div class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight text-ink">Audit log</h1>
      <p class="mt-1 text-sm text-muted">
        Every sign-in, permission change, entry edit and approval. Times in {{ zone }}.
      </p>
    </div>

    <section class="card overflow-hidden">
      <div class="flex flex-wrap items-end gap-3 border-b border-line p-4">
        <div class="w-60">
          <SearchSelect
            v-model="action"
            label="Action"
            :options="actionOptions"
            search-placeholder="Search actions"
          />
        </div>
        <div class="w-48">
          <SearchSelect
            v-model="actorId"
            label="Who"
            :options="actorOptions"
            search-placeholder="Search people"
          />
        </div>
        <label class="flex flex-col gap-1.5 text-[13px] font-medium text-ink"
          >From
          <input v-model="from" type="date" class="field h-[38px] w-40" :max="to || undefined"
        /></label>
        <label class="flex flex-col gap-1.5 text-[13px] font-medium text-ink"
          >To <input v-model="to" type="date" class="field h-[38px] w-40" :min="from || undefined"
        /></label>
        <BaseButton v-if="filtered" variant="ghost" size="sm" icon="x" class="mb-1" @click="clear"
          >Clear</BaseButton
        >
        <p v-if="rangeError" class="w-full text-[13px] text-danger" role="alert">
          {{ rangeError }}
        </p>
      </div>

      <DataTable
        :columns="columns"
        :rows="data?.items ?? []"
        :row-key="(r) => r.id"
        :loading="loading && !data"
        :class="loading && data && 'opacity-60 transition-opacity'"
      >
        <template #when="{ row }"
          ><span class="num text-[13px] whitespace-nowrap text-muted">{{
            when(row.createdAt)
          }}</span></template
        >
        <template #actor="{ row }">
          <span v-if="row.actor" class="flex items-center gap-2 whitespace-nowrap text-ink">
            <UserAvatar :name="row.actor.name" :size="22" />{{ row.actor.name }}
          </span>
          <span v-else class="text-faint">System</span>
        </template>
        <template #action="{ row }">
          <StatusBadge :tone="tone(row.action)">{{ auditActionLabel(row.action) }}</StatusBadge>
        </template>
        <template #target="{ row }">
          <span v-if="row.targetType" class="text-[13px] whitespace-nowrap text-muted"
            >{{ row.targetType.replace('_', ' ') }}
            <span class="font-mono text-xs text-faint">{{ row.targetId?.slice(0, 8) }}</span></span
          >
          <span v-else class="text-faint">—</span>
        </template>
        <template #ip="{ row }"
          ><span class="font-mono text-xs text-muted">{{ row.ip ?? '—' }}</span></template
        >
        <template #open="{ row }">
          <BaseButton size="sm" variant="ghost" @click="selected = row">{{
            hasDiff(row) ? 'Changes' : 'Details'
          }}</BaseButton>
        </template>
        <template #empty>
          <EmptyState
            art="compass"
            :title="filtered ? 'No matching events' : 'No events yet'"
            description="Try another action, person or date range."
          />
        </template>
      </DataTable>
      <PaginationBar
        v-if="data && data.total > PAGE_SIZE"
        v-model="page"
        :total="data.total"
        :page-size="PAGE_SIZE"
        noun="events"
      />
    </section>

    <BaseModal
      :open="selected !== null"
      :title="selected ? auditActionLabel(selected.action) : ''"
      :description="selected ? when(selected.createdAt, 'long') : ''"
      size="lg"
      @update:open="(v) => !v && (selected = null)"
    >
      <template v-if="selected">
        <dl class="mb-5 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-[13px]">
          <dt class="text-faint">Who</dt>
          <dd class="text-ink">
            {{ selected.actor ? `${selected.actor.name} · ${selected.actor.email}` : 'System' }}
          </dd>
          <dt class="text-faint">Action</dt>
          <dd class="font-mono text-xs text-ink">{{ selected.action }}</dd>
          <template v-if="selected.targetType">
            <dt class="text-faint">Target</dt>
            <dd class="font-mono text-xs break-all text-ink">
              {{ selected.targetType }} {{ selected.targetId }}
            </dd>
          </template>
          <dt class="text-faint">IP address</dt>
          <dd class="font-mono text-xs text-ink">{{ selected.ip ?? '—' }}</dd>
          <dt class="text-faint">Device</dt>
          <dd class="text-xs break-all text-muted">{{ selected.userAgent ?? '—' }}</dd>
          <template v-if="selected.requestId">
            <dt class="text-faint">Request</dt>
            <dd class="font-mono text-xs text-muted">{{ selected.requestId }}</dd>
          </template>
        </dl>
        <AuditDiff :before="selected.before" :after="selected.after" />
      </template>
    </BaseModal>
  </div>
</template>
