<script setup lang="ts">
import { computed, ref } from 'vue';
import { useProjectsStore } from '../../stores/projects.ts';
import ProjectDot from '../ui/ProjectDot.vue';
import SearchSelect, { type SelectOption } from '../ui/SearchSelect.vue';

/** Searchable project → task picker; projects carry their colors, tasks sit under them. */
const props = withDefaults(
  defineProps<{
    appearance?: 'field' | 'inline';
    /** Phones: show only the color dot (the narrow timer bar). */
    compactOnPhone?: boolean;
    label?: string;
    error?: string | null;
    disabled?: boolean;
  }>(),
  { appearance: 'field', compactOnPhone: false },
);
const compact = computed(() => props.appearance === 'inline' && props.compactOnPhone);
const projectId = defineModel<string | null>('projectId', { default: null });
const taskId = defineModel<string | null>('taskId', { default: null });

const projects = useProjectsStore();
const select = ref<InstanceType<typeof SearchSelect> | null>(null);

const options = computed<SelectOption[]>(() =>
  projects.trackable.flatMap((project) => {
    const group = project.client?.name ?? 'Internal';
    return [
      {
        value: project.id,
        label: project.name,
        color: project.color,
        group,
        hint: project.isBillable ? '' : 'non-billable',
      },
      ...(projects.tasks[project.id] ?? [])
        .filter((task) => !task.isDone || task.id === taskId.value)
        .map((task) => ({
          value: `${project.id}:${task.id}`,
          label: task.name,
          group,
          indent: true,
          keywords: project.name,
        })),
    ];
  }),
);

const value = computed({
  get: () =>
    projectId.value
      ? taskId.value
        ? `${projectId.value}:${taskId.value}`
        : projectId.value
      : null,
  set: (next: string | null) => {
    const [project = null, task = null] = next ? next.split(':') : [];
    projectId.value = project;
    taskId.value = task;
  },
});

const project = computed(() => projects.byId(projectId.value));
const task = computed(
  () => (projects.tasks[projectId.value ?? ''] ?? []).find((t) => t.id === taskId.value) ?? null,
);

function onOpen(): void {
  void projects
    .load()
    .then(() => projects.loadAllTasks())
    .catch(() => undefined);
}

defineExpose({ show: () => select.value?.show() });
</script>

<template>
  <SearchSelect
    ref="select"
    v-model="value"
    :options="options"
    :appearance="appearance"
    :label="label"
    :error="error"
    :disabled="disabled"
    placeholder="Project"
    search-placeholder="Find a project or task…"
    :empty-text="
      projects.trackable.length === 0
        ? 'You aren’t assigned to any project yet'
        : 'No project or task matches'
    "
    @open="onOpen"
  >
    <template #trigger>
      <span class="flex min-w-0 items-center gap-2">
        <template v-if="project">
          <ProjectDot :color="project.color" />
          <span
            class="truncate font-medium"
            :class="compact && 'max-sm:sr-only'"
            :style="{ color: appearance === 'inline' ? project.color : undefined }"
            >{{ project.name }}</span
          >
          <span
            v-if="task"
            class="truncate text-muted"
            :class="appearance === 'inline' && 'max-sm:hidden'"
            >· {{ task.name }}</span
          >
        </template>
        <span v-else class="flex items-center gap-2 text-faint">
          <span class="size-2 rounded-full border border-dashed border-faint" />
          <span :class="compact && 'max-sm:sr-only'">Project</span>
        </span>
      </span>
    </template>
  </SearchSelect>
</template>
