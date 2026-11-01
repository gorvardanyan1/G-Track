<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { toLocalDate, type TimeEntryResponse } from '@tempo/shared';
import { formatDuration, timeOf } from '../../lib/time.ts';
import { useClockStore } from '../../stores/clock.ts';
import AppIcon from '../ui/AppIcon.vue';
import IconButton from '../ui/IconButton.vue';
import StatusBadge from '../ui/StatusBadge.vue';
import ProjectTaskPicker from './ProjectTaskPicker.vue';

const props = defineProps<{ entry: TimeEntryResponse; zone: string }>();
const emit = defineEmits<{
  update: [
    patch: {
      description?: string;
      projectId?: string;
      taskId?: string | null;
      isBillable?: boolean;
    },
  ];
  edit: [];
  continue: [];
  duplicate: [];
  remove: [];
}>();

const clock = useClockStore();
const description = ref(props.entry.description);
watch(
  () => props.entry.description,
  (value) => (description.value = value),
);

const running = computed(() => props.entry.endedAt === null);
const seconds = computed(() =>
  running.value ? clock.elapsed(props.entry.startedAt) : (props.entry.durationSeconds ?? 0),
);
const color = computed(() => props.entry.project.color);
/** "+1" when the entry ends on a later local day. */
const dayShift = computed(() => {
  if (!props.entry.endedAt) return 0;
  const start = toLocalDate(new Date(props.entry.startedAt), props.zone);
  const end = toLocalDate(new Date(props.entry.endedAt), props.zone);
  return Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000);
});

const projectId = computed({
  get: () => props.entry.projectId,
  set: (value) =>
    value && value !== props.entry.projectId && emit('update', { projectId: value, taskId: null }),
});
const taskId = computed({
  get: () => props.entry.taskId,
  set: (value) =>
    value !== props.entry.taskId &&
    emit('update', { projectId: props.entry.projectId, taskId: value }),
});

function commit(): void {
  const value = description.value.trim();
  if (value !== props.entry.description) emit('update', { description: value });
}
</script>

<template>
  <div
    class="group relative flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 pr-3 pl-4 transition-colors hover:bg-surface-2/50 sm:flex-nowrap"
    :class="running && 'bg-running-soft/40'"
  >
    <span
      class="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full"
      :style="{ background: color }"
      aria-hidden="true"
    />

    <input
      v-if="entry.editable"
      v-model="description"
      class="h-8 min-w-0 flex-1 basis-full rounded-lg bg-transparent px-1.5 text-sm text-ink outline-none placeholder:text-faint hover:bg-surface-2 focus:bg-surface focus:shadow-[var(--focus-ring)] sm:basis-auto"
      placeholder="Add a description"
      aria-label="Description"
      maxlength="500"
      @keydown.enter="($event.target as HTMLInputElement).blur()"
      @blur="commit"
    />
    <span
      v-else
      class="min-w-0 flex-1 basis-full truncate px-1.5 text-sm sm:basis-auto"
      :class="entry.description ? 'text-ink' : 'text-faint'"
    >
      {{ entry.description || 'No description' }}
    </span>

    <ProjectTaskPicker
      v-if="entry.editable"
      v-model:project-id="projectId"
      v-model:task-id="taskId"
      appearance="inline"
      class="max-w-[220px] min-w-0"
    />
    <span v-else class="flex max-w-[220px] min-w-0 items-center gap-2 px-2.5 text-sm">
      <span class="truncate font-medium" :style="{ color }">{{ entry.project.name }}</span>
      <span v-if="entry.task" class="truncate text-muted">· {{ entry.task.name }}</span>
    </span>

    <button
      type="button"
      class="hidden size-8 shrink-0 items-center justify-center rounded-lg transition-colors sm:inline-flex"
      :class="entry.isBillable ? 'text-accent-ink' : 'text-faint/60'"
      :disabled="!entry.editable"
      :aria-pressed="entry.isBillable"
      :title="entry.isBillable ? 'Billable' : 'Not billable'"
      aria-label="Billable"
      @click="emit('update', { isBillable: !entry.isBillable })"
    >
      <AppIcon name="dollar" :size="16" :stroke="entry.isBillable ? 2.1 : 1.5" />
    </button>

    <button
      type="button"
      class="num shrink-0 rounded-lg px-2 py-1 text-[13px] text-muted transition-colors enabled:hover:bg-surface-2 enabled:hover:text-ink"
      :disabled="!entry.editable || running"
      :title="entry.editable && !running ? 'Edit times' : undefined"
      @click="emit('edit')"
    >
      {{ timeOf(entry.startedAt, zone) }} – {{ entry.endedAt ? timeOf(entry.endedAt, zone) : 'now'
      }}<sup v-if="dayShift > 0" class="ml-0.5 text-accent-ink">+{{ dayShift }}</sup>
    </button>

    <span
      class="num w-[76px] shrink-0 text-right text-[15px] font-medium"
      :class="running ? 'text-running' : 'text-ink'"
    >
      {{ formatDuration(seconds) }}
    </span>

    <div class="flex w-[100px] shrink-0 items-center justify-end">
      <StatusBadge v-if="running" tone="success" dot class="mr-1">Running</StatusBadge>
      <template v-else>
        <span
          v-if="!entry.editable"
          class="mr-1 text-faint"
          title="Locked: this period is closed or the week was submitted"
        >
          <AppIcon name="lock" :size="15" />
        </span>
        <div
          class="flex opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100"
        >
          <IconButton icon="play" label="Continue" size="sm" @click="emit('continue')" />
          <IconButton icon="copy" label="Duplicate to today" size="sm" @click="emit('duplicate')" />
          <IconButton
            v-if="entry.editable"
            icon="trash"
            label="Delete"
            size="sm"
            tone="danger"
            @click="emit('remove')"
          />
        </div>
      </template>
    </div>
  </div>
</template>
