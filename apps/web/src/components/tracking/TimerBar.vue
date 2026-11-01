<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useProjectsStore } from '../../stores/projects.ts';
import { useEntriesStore } from '../../stores/entries.ts';
import { useTimerStore } from '../../stores/timer.ts';
import { useToastStore } from '../../stores/toasts.ts';
import { formatDuration } from '../../lib/time.ts';
import AppIcon from '../ui/AppIcon.vue';
import ProjectTaskPicker from './ProjectTaskPicker.vue';
import TimerButton from './TimerButton.vue';

/**
 * The global timer: what you're doing, on which project/task, billable, elapsed and start/stop.
 * While running, edits go straight to the running entry (and every tab sees them).
 */
const timer = useTimerStore();
const projects = useProjectsStore();
const entries = useEntriesStore();
const toasts = useToastStore();
const picker = ref<InstanceType<typeof ProjectTaskPicker> | null>(null);
const description = ref(timer.draft.description);

watch(
  () => timer.draft.description,
  (value) => (description.value = value),
);

const billable = computed(() => {
  if (timer.draft.isBillable !== null) return timer.draft.isBillable;
  return projects.byId(timer.draft.projectId)?.isBillable ?? true;
});

/** Saves a change to the running entry, or keeps it in the draft. */
async function change(
  patch: Partial<{
    description: string;
    projectId: string;
    taskId: string | null;
    isBillable: boolean;
  }>,
) {
  timer.draft = { ...timer.draft, ...patch };
  const running = timer.running;
  if (!running) return;
  try {
    timer.applySaved(await entries.update(running.id, patch));
  } catch (error) {
    toasts.error(error, 'Could not update the timer');
  }
}

const projectId = computed({
  get: () => timer.draft.projectId,
  set: (value) => {
    if (value && value !== timer.draft.projectId) void change({ projectId: value, taskId: null });
  },
});
const taskId = computed({
  get: () => timer.draft.taskId,
  set: (value) => {
    if (value !== timer.draft.taskId && timer.draft.projectId)
      void change({ projectId: timer.draft.projectId, taskId: value });
  },
});

function commitDescription(): void {
  const value = description.value.trim();
  if (value !== timer.draft.description) void change({ description: value });
}

async function toggle(): Promise<void> {
  try {
    if (timer.running) return await timer.stop();
    timer.draft.description = description.value.trim();
    if (!timer.draft.projectId) {
      picker.value?.show();
      return;
    }
    await timer.start();
  } catch (error) {
    toasts.error(error, timer.running ? 'Could not stop the timer' : 'Could not start the timer');
  }
}

defineExpose({ toggle });
</script>

<template>
  <div
    role="region"
    aria-label="Timer"
    class="flex min-w-0 flex-1 items-center gap-1 rounded-2xl border bg-surface py-1 pr-1.5 pl-3 shadow-card transition-[border-color,box-shadow] duration-300 sm:gap-2"
    :class="
      timer.running ? 'border-running/40 shadow-[0_0_0_4px_var(--running-soft)]' : 'border-line'
    "
  >
    <input
      v-model="description"
      class="h-9 min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-faint sm:text-[15px]"
      :placeholder="timer.running ? 'Add a description' : 'What are you working on?'"
      aria-label="Description"
      maxlength="500"
      @keydown.enter="
        ($event.target as HTMLInputElement).blur();
        !timer.running && toggle();
      "
      @blur="commitDescription"
    />
    <ProjectTaskPicker
      ref="picker"
      v-model:project-id="projectId"
      v-model:task-id="taskId"
      appearance="inline"
      compact-on-phone
      class="max-w-[40px] min-w-0 sm:max-w-[260px]"
    />
    <button
      type="button"
      class="hidden size-9 shrink-0 items-center justify-center rounded-[10px] transition-colors sm:inline-flex"
      :class="billable ? 'text-accent-ink hover:bg-accent-soft' : 'text-faint hover:bg-surface-2'"
      :aria-pressed="billable"
      :title="billable ? 'Billable' : 'Not billable'"
      aria-label="Billable"
      @click="change({ isBillable: !billable })"
    >
      <AppIcon name="dollar" :size="17" :stroke="billable ? 2.1 : 1.6" />
    </button>
    <span
      class="num w-[74px] shrink-0 text-right text-[15px] font-medium sm:w-[96px] sm:text-[17px]"
      :class="timer.running ? 'text-ink' : 'text-faint'"
      aria-live="off"
      :aria-label="`Elapsed ${formatDuration(timer.elapsed)}`"
    >
      {{ formatDuration(timer.elapsed) }}
    </span>
    <TimerButton :running="timer.running !== null" :busy="timer.busy" @click="toggle" />
  </div>
</template>
