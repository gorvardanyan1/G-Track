<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { ClientResponse, ProjectResponse } from '@tempo/shared';
import { clientsApi } from '../../api/clients.ts';
import { projectsApi } from '../../api/projects.ts';
import { ApiError } from '../../api/client.ts';
import { optionalNumber } from '../../lib/number.ts';
import { useToastStore } from '../../stores/toasts.ts';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import FormField from '../ui/FormField.vue';
import SearchSelect from '../ui/SearchSelect.vue';
import TextField from '../ui/TextField.vue';
import ToggleSwitch from '../ui/ToggleSwitch.vue';

/** Create (no `project`) or edit a project. Super Admin only. */
const props = defineProps<{ project?: ProjectResponse | null; defaultClientId?: string | null }>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ saved: [project: ProjectResponse] }>();
const toasts = useToastStore();

const PALETTE = [
  '#5B5BF7',
  '#0EA5E9',
  '#10B981',
  '#84CC16',
  '#F59E0B',
  '#F97316',
  '#EF4444',
  '#EC4899',
  '#A855F7',
  '#64748B',
];
const NO_CLIENT = '__none__';

const name = ref('');
const color = ref(PALETTE[0] ?? '#5B5BF7');
const selectedClient = ref<string | null>(NO_CLIENT);
const budget = ref<string | number>('');
const billable = ref(true);
const clients = ref<ClientResponse[]>([]);
const saving = ref(false);
const errors = ref<Record<string, string>>({});

watch(open, async (isOpen) => {
  if (!isOpen) return;
  const p = props.project;
  name.value = p?.name ?? '';
  color.value = p?.color ?? PALETTE[0] ?? '#5B5BF7';
  selectedClient.value = p ? (p.client?.id ?? NO_CLIENT) : (props.defaultClientId ?? NO_CLIENT);
  budget.value = String(p?.budgetHours ?? '');
  billable.value = p?.isBillable ?? true;
  errors.value = {};
  try {
    clients.value = (await clientsApi.list()).filter(
      (c) => c.archivedAt === null || c.id === p?.client?.id,
    );
  } catch (e) {
    toasts.error(e, 'Could not load clients');
  }
});

const clientOptions = computed(() => [
  { value: NO_CLIENT, label: 'No client (internal)' },
  ...clients.value.map((c) => ({ value: c.id, label: c.name })),
]);

async function save(): Promise<void> {
  errors.value = {};
  const budgetHours = optionalNumber(budget.value);
  if (!name.value.trim()) errors.value['name'] = 'Give the project a name';
  if (budgetHours !== null && !(budgetHours > 0))
    errors.value['budget'] = 'Use a positive number of hours, or leave it empty';
  if (Object.keys(errors.value).length) return;

  const body = {
    name: name.value.trim(),
    color: color.value,
    clientId: selectedClient.value === NO_CLIENT ? null : selectedClient.value,
    budgetHours,
    isBillable: billable.value,
  };
  saving.value = true;
  try {
    const saved = props.project
      ? await projectsApi.update(props.project.id, body)
      : await projectsApi.create(body);
    toasts.success(props.project ? 'Project updated' : 'Project created', saved.name);
    emit('saved', saved);
    open.value = false;
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) errors.value['name'] = e.message;
    else toasts.error(e, 'Could not save the project');
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <BaseModal v-model:open="open" :title="project ? 'Edit project' : 'New project'">
    <form id="project-form" class="space-y-4" @submit.prevent="save">
      <TextField v-model="name" label="Name" :error="errors['name']" maxlength="120" autofocus />
      <SearchSelect v-model="selectedClient" label="Client" :options="clientOptions" />
      <FormField label="Color">
        <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Project color">
          <button
            v-for="c in PALETTE"
            :key="c"
            type="button"
            role="radio"
            :aria-checked="color.toLowerCase() === c.toLowerCase()"
            :aria-label="c"
            class="size-7 rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110"
            :class="color.toLowerCase() === c.toLowerCase() && 'ring-2 ring-ink'"
            :style="{ background: c }"
            @click="color = c"
          />
        </div>
      </FormField>
      <div class="grid grid-cols-2 items-end gap-4">
        <TextField
          v-model="budget"
          label="Budget (hours)"
          type="number"
          min="0"
          step="0.25"
          placeholder="No budget"
          :error="errors['budget']"
        />
        <div class="pb-2.5"><ToggleSwitch v-model="billable">Billable</ToggleSwitch></div>
      </div>
    </form>
    <template #footer>
      <BaseButton variant="ghost" @click="open = false">Cancel</BaseButton>
      <BaseButton variant="primary" type="submit" form="project-form" :loading="saving">{{
        project ? 'Save' : 'Create project'
      }}</BaseButton>
    </template>
  </BaseModal>
</template>
