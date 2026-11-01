<script setup lang="ts">
import { ref } from 'vue';
import type { TaskResponse } from '@tempo/shared';
import { projectsApi } from '../../api/projects.ts';
import { listEnter, listLeave } from '../../lib/motion.ts';
import { useToastStore } from '../../stores/toasts.ts';
import AppIcon from '../ui/AppIcon.vue';
import BaseButton from '../ui/BaseButton.vue';
import IconButton from '../ui/IconButton.vue';

const props = defineProps<{
  projectId: string;
  tasks: readonly TaskResponse[] | null;
  canManage: boolean;
}>();
const emit = defineEmits<{ changed: [] }>();
const toasts = useToastStore();

const name = ref('');
const adding = ref(false);
const renaming = ref<string | null>(null);
const draft = ref('');

async function add(): Promise<void> {
  if (!name.value.trim()) return;
  adding.value = true;
  try {
    await projectsApi.createTask(props.projectId, name.value.trim());
    name.value = '';
    emit('changed');
  } catch (e) {
    toasts.error(e, 'Could not add the task');
  } finally {
    adding.value = false;
  }
}
async function update(task: TaskResponse, body: { name?: string; isDone?: boolean }) {
  try {
    await projectsApi.updateTask(props.projectId, task.id, body);
    emit('changed');
  } catch (e) {
    toasts.error(e, 'Could not update the task');
  }
}
function startRename(task: TaskResponse): void {
  renaming.value = task.id;
  draft.value = task.name;
}
async function finishRename(task: TaskResponse): Promise<void> {
  if (renaming.value !== task.id) return;
  renaming.value = null;
  if (draft.value.trim() && draft.value.trim() !== task.name)
    await update(task, { name: draft.value.trim() });
}
async function remove(task: TaskResponse): Promise<void> {
  try {
    await projectsApi.deleteTask(props.projectId, task.id);
    toasts.success('Task deleted', task.name);
    emit('changed');
  } catch (e) {
    toasts.error(e, 'Could not delete the task');
  }
}
</script>

<template>
  <section class="card">
    <header class="px-5 pt-5 pb-3">
      <h2 class="text-sm font-semibold text-ink">
        Tasks <span class="font-normal text-faint">{{ tasks?.length ?? '' }}</span>
      </h2>
    </header>
    <form v-if="canManage" class="flex gap-2 px-5 pb-3" @submit.prevent="add">
      <input
        v-model="name"
        class="field h-9 flex-1"
        placeholder="New task name"
        maxlength="120"
        aria-label="New task name"
      />
      <BaseButton type="submit" size="sm" icon="plus" :loading="adding" :disabled="!name.trim()"
        >Add</BaseButton
      >
    </form>
    <div v-if="!tasks" class="space-y-3 px-5 pb-5">
      <div
        v-for="i in 3"
        :key="i"
        class="skeleton h-4 rounded"
        :style="{ width: `${50 + i * 10}%` }"
      />
    </div>
    <p v-else-if="tasks.length === 0" class="px-5 pt-2 pb-8 text-center text-sm text-faint">
      No tasks yet. Time can still be tracked on the project itself.
    </p>
    <TransitionGroup
      v-else
      tag="ul"
      class="pb-2"
      :css="false"
      @enter="listEnter"
      @leave="listLeave"
    >
      <li
        v-for="task in tasks"
        :key="task.id"
        class="group flex h-11 items-center gap-3 px-5 hover:bg-surface-2/60"
      >
        <button
          type="button"
          role="checkbox"
          :aria-checked="task.isDone"
          :aria-label="task.isDone ? `Reopen ${task.name}` : `Mark ${task.name} done`"
          :disabled="!canManage"
          class="flex size-[18px] shrink-0 items-center justify-center rounded-md border transition-colors"
          :class="
            task.isDone ? 'border-running bg-running text-white' : 'border-line-strong bg-surface'
          "
          @click="update(task, { isDone: !task.isDone })"
        >
          <AppIcon v-if="task.isDone" name="check" :size="12" />
        </button>
        <input
          v-if="renaming === task.id"
          v-model="draft"
          class="field h-8 flex-1"
          aria-label="Task name"
          maxlength="120"
          autofocus
          @keydown.enter="finishRename(task)"
          @keydown.esc="renaming = null"
          @blur="finishRename(task)"
        />
        <span
          v-else
          class="flex-1 truncate text-sm"
          :class="task.isDone ? 'text-faint line-through' : 'text-ink'"
          @dblclick="canManage && startRename(task)"
          >{{ task.name }}</span
        >
        <span
          v-if="canManage && renaming !== task.id"
          class="flex gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100"
        >
          <IconButton
            icon="pencil"
            size="sm"
            :label="`Rename ${task.name}`"
            @click="startRename(task)"
          />
          <IconButton
            icon="trash"
            size="sm"
            tone="danger"
            :label="`Delete ${task.name}`"
            @click="remove(task)"
          />
        </span>
      </li>
    </TransitionGroup>
  </section>
</template>
