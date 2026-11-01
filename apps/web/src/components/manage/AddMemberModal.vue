<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { MemberCandidateResponse, ProjectRole } from '@tempo/shared';
import { projectsApi } from '../../api/projects.ts';
import { optionalNumber } from '../../lib/number.ts';
import { useToastStore } from '../../stores/toasts.ts';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import SearchSelect from '../ui/SearchSelect.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import TextField from '../ui/TextField.vue';

const props = defineProps<{ projectId: string; canAddPms: boolean }>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ added: [] }>();
const toasts = useToastStore();

const candidates = ref<MemberCandidateResponse[]>([]);
const userId = ref<string | null>(null);
const role = ref<ProjectRole>('WORKER');
const rate = ref<string | number>('');
const rateError = ref<string | null>(null);
const saving = ref(false);

watch(open, async (isOpen) => {
  if (!isOpen) return;
  userId.value = null;
  role.value = 'WORKER';
  rate.value = '';
  rateError.value = null;
  try {
    candidates.value = await projectsApi.memberCandidates(props.projectId);
  } catch (e) {
    toasts.error(e, 'Could not load people');
  }
});

const ROLE_LABEL = { WORKER: 'Worker', PROJECT_MANAGER: 'Project manager', SUPER_ADMIN: 'Admin' };
const options = computed(() =>
  candidates.value
    .filter((c) => role.value === 'WORKER' || c.role === 'PROJECT_MANAGER')
    .map((c) => ({ value: c.id, label: c.name, hint: ROLE_LABEL[c.role], keywords: c.email })),
);
watch(role, () => {
  if (!options.value.some((o) => o.value === userId.value)) userId.value = null;
});

async function add(): Promise<void> {
  if (!userId.value) return;
  const hourlyRate = optionalNumber(rate.value);
  if (hourlyRate !== null && !(hourlyRate >= 0)) {
    rateError.value = 'Use a positive amount, or leave it empty';
    return;
  }
  saving.value = true;
  try {
    await projectsApi.upsertMember(props.projectId, userId.value, {
      roleInProject: role.value,
      hourlyRate,
    });
    toasts.success('Member added');
    emit('added');
    open.value = false;
  } catch (e) {
    toasts.error(e, 'Could not add the member');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <BaseModal v-model:open="open" title="Add member" size="sm">
    <form id="add-member" class="space-y-4" @submit.prevent="add">
      <SegmentedControl
        v-if="canAddPms"
        v-model="role"
        label="Role in project"
        :options="[
          { value: 'WORKER', label: 'Worker' },
          { value: 'PM', label: 'Project manager' },
        ]"
      />
      <SearchSelect
        v-model="userId"
        label="Person"
        placeholder="Choose someone"
        search-placeholder="Search by name or email"
        empty-text="Everyone is already on this project"
        :options="options"
      />
      <TextField
        v-model="rate"
        label="Hourly rate"
        type="number"
        min="0"
        step="0.01"
        placeholder="No rate"
        hint="Used for billable amounts in reports."
        :error="rateError"
      />
    </form>
    <template #footer>
      <BaseButton variant="ghost" @click="open = false">Cancel</BaseButton>
      <BaseButton
        variant="primary"
        type="submit"
        form="add-member"
        :disabled="!userId"
        :loading="saving"
        >Add</BaseButton
      >
    </template>
  </BaseModal>
</template>
