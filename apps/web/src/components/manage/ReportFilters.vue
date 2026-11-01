<script setup lang="ts">
import { computed, watch } from 'vue';
import type { ReportOptionsResponse } from '@tempo/shared';
import SearchSelect from '../ui/SearchSelect.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';

export interface ReportFilterValues {
  projectId: string | null;
  taskId: string | null;
  userId: string | null;
  clientId: string | null;
  billable: 'all' | 'billable' | 'non-billable';
}

const props = defineProps<{ options: ReportOptionsResponse | null; showClients: boolean }>();
const model = defineModel<ReportFilterValues>({ required: true });

/** "All" is a real option so the trigger always says what is selected. */
const ALL = '*';
const set = (key: 'projectId' | 'taskId' | 'userId' | 'clientId', value: string | null) => {
  model.value = { ...model.value, [key]: value === ALL ? null : value };
};

const projects = computed(() => [
  { value: ALL, label: 'All projects' },
  ...(props.options?.projects ?? [])
    .filter((p) => !model.value.clientId || p.clientId === model.value.clientId)
    .map((p) => ({
      value: p.id,
      label: p.name,
      color: p.color,
      hint: p.archived ? 'Archived' : undefined,
    })),
]);
const tasks = computed(() => [
  { value: ALL, label: 'All tasks' },
  ...(props.options?.tasks ?? [])
    .filter((t) => t.projectId === model.value.projectId)
    .map((t) => ({ value: t.id, label: t.name })),
]);
const users = computed(() => [
  { value: ALL, label: 'Everyone' },
  ...(props.options?.users ?? []).map((u) => ({ value: u.id, label: u.name })),
]);
const clients = computed(() => [
  { value: ALL, label: 'All clients' },
  ...(props.options?.clients ?? []).map((c) => ({ value: c.id, label: c.name })),
]);

// A task belongs to one project; a project to one client.
watch(
  () => model.value.projectId,
  () => model.value.taskId && set('taskId', null),
);
watch(
  () => model.value.clientId,
  (clientId) => {
    const project = props.options?.projects.find((p) => p.id === model.value.projectId);
    if (clientId && project && project.clientId !== clientId) set('projectId', null);
  },
);
</script>

<template>
  <div class="flex flex-wrap items-end gap-3">
    <div v-if="showClients" class="w-44">
      <SearchSelect
        :model-value="model.clientId ?? ALL"
        label="Client"
        :options="clients"
        @update:model-value="(v) => set('clientId', v)"
      />
    </div>
    <div class="w-52">
      <SearchSelect
        :model-value="model.projectId ?? ALL"
        label="Project"
        :options="projects"
        search-placeholder="Search projects"
        @update:model-value="(v) => set('projectId', v)"
      />
    </div>
    <div class="w-44">
      <SearchSelect
        :model-value="model.taskId ?? ALL"
        label="Task"
        :options="tasks"
        :disabled="!model.projectId"
        @update:model-value="(v) => set('taskId', v)"
      />
    </div>
    <div class="w-44">
      <SearchSelect
        :model-value="model.userId ?? ALL"
        label="Worker"
        :options="users"
        search-placeholder="Search people"
        @update:model-value="(v) => set('userId', v)"
      />
    </div>
    <SegmentedControl
      :model-value="model.billable"
      label="Billable"
      :options="[
        { value: 'all', label: 'All' },
        { value: 'billable', label: 'Billable' },
        { value: 'non-billable', label: 'Non-billable' },
      ]"
      @update:model-value="(v) => (model = { ...model, billable: v })"
    />
  </div>
</template>
