<script setup lang="ts">
import { computed, ref } from 'vue';
import {
  projectPermissions,
  type MemberResponse,
  type ProjectAccess,
  type ProjectUsageDetailResponse,
} from '@tempo/shared';
import { projectsApi } from '../../api/projects.ts';
import { hoursLabel, money } from '../../lib/time.ts';
import { optionalNumber } from '../../lib/number.ts';
import { useToastStore } from '../../stores/toasts.ts';
import BaseButton from '../ui/BaseButton.vue';
import ConfirmDialog from '../ui/ConfirmDialog.vue';
import DataTable from '../ui/DataTable.vue';
import IconButton from '../ui/IconButton.vue';
import StatusBadge from '../ui/StatusBadge.vue';
import UserAvatar from '../ui/UserAvatar.vue';
import AddMemberModal from './AddMemberModal.vue';

const props = defineProps<{
  projectId: string;
  access: ProjectAccess;
  archived: boolean;
  members: readonly MemberResponse[] | null;
  usage: ProjectUsageDetailResponse | null;
}>();
const emit = defineEmits<{ changed: [] }>();
const toasts = useToastStore();

const adding = ref(false);
const editingRate = ref<string | null>(null);
const rateDraft = ref<string | number>('');
const removing = ref<MemberResponse | null>(null);
const busy = ref(false);

/** PMs manage workers; only admins manage PMs. */
const canManage = (m: MemberResponse) =>
  !props.archived &&
  (m.roleInProject === 'PM'
    ? projectPermissions.managePms(props.access)
    : projectPermissions.manageWorkers(props.access));
const usageOf = (userId: string) => props.usage?.byMember.find((u) => u.user.id === userId);

function startRate(m: MemberResponse): void {
  editingRate.value = m.userId;
  rateDraft.value = m.hourlyRate === null ? '' : String(m.hourlyRate);
}
async function saveRate(m: MemberResponse): Promise<void> {
  if (editingRate.value !== m.userId) return;
  editingRate.value = null;
  const hourlyRate = optionalNumber(rateDraft.value);
  if (hourlyRate === m.hourlyRate) return;
  if (hourlyRate !== null && !(hourlyRate >= 0)) {
    toasts.info('Rate not changed', 'Use a positive amount, or leave it empty.');
    return;
  }
  try {
    await projectsApi.upsertMember(props.projectId, m.userId, {
      roleInProject: m.roleInProject,
      hourlyRate,
    });
    toasts.success('Rate updated', m.name);
    emit('changed');
  } catch (e) {
    toasts.error(e, 'Could not update the rate');
  }
}
async function remove(): Promise<void> {
  if (!removing.value) return;
  busy.value = true;
  try {
    await projectsApi.removeMember(props.projectId, removing.value.userId);
    toasts.success('Removed from the project', removing.value.name);
    removing.value = null;
    emit('changed');
  } catch (e) {
    toasts.error(e, 'Could not remove the member');
  } finally {
    busy.value = false;
  }
}

const canAdd = computed(() => !props.archived && projectPermissions.manageWorkers(props.access));
const columns = [
  { key: 'member', label: 'Member' },
  { key: 'role', label: 'Role' },
  { key: 'rate', label: 'Hourly rate', align: 'right' as const },
  { key: 'week', label: 'This week', align: 'right' as const },
  { key: 'total', label: 'Total', align: 'right' as const },
  { key: 'actions', label: '', class: 'w-12' },
];
</script>

<template>
  <section class="card">
    <header class="flex items-center justify-between px-5 pt-5 pb-3">
      <h2 class="text-sm font-semibold text-ink">
        Members <span class="font-normal text-faint">{{ members?.length ?? '' }}</span>
      </h2>
      <BaseButton v-if="canAdd" size="sm" icon="plus" @click="adding = true">Add member</BaseButton>
    </header>
    <DataTable
      :columns="columns"
      :rows="members ?? []"
      :row-key="(m) => m.userId"
      :loading="!members"
    >
      <template #member="{ row }">
        <span class="flex items-center gap-3">
          <UserAvatar :name="row.name" :size="28" />
          <span class="min-w-0">
            <span class="block truncate font-medium text-ink">{{ row.name }}</span>
            <span class="block truncate text-xs text-faint">{{ row.email }}</span>
          </span>
        </span>
      </template>
      <template #role="{ row }">
        <StatusBadge :tone="row.roleInProject === 'PM' ? 'accent' : 'neutral'">{{
          row.roleInProject === 'PM' ? 'Project manager' : 'Worker'
        }}</StatusBadge>
      </template>
      <template #rate="{ row }">
        <input
          v-if="editingRate === row.userId"
          v-model="rateDraft"
          type="number"
          min="0"
          step="0.01"
          class="field num h-8 w-28 text-right"
          aria-label="Hourly rate"
          autofocus
          @keydown.enter="saveRate(row)"
          @keydown.esc="editingRate = null"
          @blur="saveRate(row)"
        />
        <button
          v-else-if="canManage(row)"
          type="button"
          class="num rounded-md px-2 py-1 text-ink hover:bg-surface-2"
          title="Change rate"
          @click="startRate(row)"
        >
          {{ row.hourlyRate === null ? '—' : money(row.hourlyRate * 100) }}
        </button>
        <span v-else class="num px-2 text-muted">{{
          row.hourlyRate === null ? '—' : money(row.hourlyRate * 100)
        }}</span>
      </template>
      <template #week="{ row }"
        ><span class="num whitespace-nowrap text-muted">{{
          hoursLabel(usageOf(row.userId)?.weekSeconds ?? 0)
        }}</span></template
      >
      <template #total="{ row }"
        ><span class="num font-medium whitespace-nowrap text-ink">{{
          hoursLabel(usageOf(row.userId)?.totalSeconds ?? 0)
        }}</span></template
      >
      <template #actions="{ row }">
        <IconButton
          v-if="canManage(row)"
          icon="trash"
          tone="danger"
          size="sm"
          :label="`Remove ${row.name}`"
          @click="removing = row"
        />
      </template>
      <template #empty>
        <p class="px-5 py-8 text-center text-sm text-faint">No one is on this project yet.</p>
      </template>
    </DataTable>

    <AddMemberModal
      v-model:open="adding"
      :project-id="projectId"
      :can-add-pms="projectPermissions.managePms(access)"
      @added="emit('changed')"
    />
    <ConfirmDialog
      :open="removing !== null"
      title="Remove from project?"
      confirm-label="Remove"
      tone="danger"
      :loading="busy"
      @update:open="(v) => !v && (removing = null)"
      @confirm="remove"
    >
      <strong class="text-ink">{{ removing?.name }}</strong> won’t be able to track time on this
      project any more. Their existing entries stay.
    </ConfirmDialog>
  </section>
</template>
