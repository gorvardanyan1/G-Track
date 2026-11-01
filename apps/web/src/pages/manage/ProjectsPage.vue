<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import type { ProjectResponse, ProjectUsage } from '@tempo/shared';
import { projectsApi } from '../../api/projects.ts';
import ProjectFormModal from '../../components/admin/ProjectFormModal.vue';
import BudgetBar from '../../components/manage/BudgetBar.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import EmptyState from '../../components/ui/EmptyState.vue';
import SkeletonBlock from '../../components/ui/SkeletonBlock.vue';
import StatusBadge from '../../components/ui/StatusBadge.vue';
import TextField from '../../components/ui/TextField.vue';
import ToggleSwitch from '../../components/ui/ToggleSwitch.vue';
import { listEnter } from '../../lib/motion.ts';
import { hoursLabel } from '../../lib/time.ts';
import { useActivityStore } from '../../stores/activity.ts';
import { useAuthStore } from '../../stores/auth.ts';
import { useToastStore } from '../../stores/toasts.ts';

const auth = useAuthStore();
const activity = useActivityStore();
const toasts = useToastStore();
const router = useRouter();
const isAdmin = computed(() => auth.role === 'SUPER_ADMIN');

const projects = ref<ProjectResponse[] | null>(null);
const usage = ref<Record<string, ProjectUsage>>({});
const showArchived = ref(false);
const search = ref('');
const creating = ref(false);

async function load(): Promise<void> {
  try {
    const [list, use] = await Promise.all([
      projectsApi.list(showArchived.value),
      projectsApi.usage(),
    ]);
    // A PM manages only projects where they are the PM; member projects live under "Track".
    projects.value = list.filter((p) => p.access !== 'member');
    usage.value = Object.fromEntries(use.items.map((u) => [u.project.id, u]));
  } catch (e) {
    toasts.error(e, 'Could not load projects');
  }
}
onMounted(load);
watch(showArchived, load);

const visible = computed(() => {
  const q = search.value.trim().toLowerCase();
  return (projects.value ?? []).filter(
    (p) => !q || p.name.toLowerCase().includes(q) || p.client?.name.toLowerCase().includes(q),
  );
});
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Projects</h1>
        <p class="mt-1 text-sm text-muted">
          {{ isAdmin ? 'Every project in the organization.' : 'Projects you manage.' }}
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <div class="w-56">
          <TextField v-model="search" icon="search" placeholder="Search projects" />
        </div>
        <ToggleSwitch v-if="isAdmin" v-model="showArchived">Archived</ToggleSwitch>
        <BaseButton v-if="isAdmin" variant="primary" icon="plus" @click="creating = true"
          >New project</BaseButton
        >
      </div>
    </div>

    <div v-if="!projects" class="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="i in 6" :key="i" class="card p-5">
        <SkeletonBlock width="50%" /><SkeletonBlock width="30%" class="mt-2" />
        <SkeletonBlock height="8px" class="mt-6" />
      </div>
    </div>
    <div v-else-if="visible.length === 0" class="card">
      <EmptyState
        art="compass"
        :title="search ? 'No matching projects' : 'No projects yet'"
        :description="
          search
            ? 'Try another name.'
            : isAdmin
              ? 'Create the first project to start tracking time.'
              : 'Projects where you are the project manager appear here.'
        "
      />
    </div>
    <TransitionGroup
      v-else
      tag="ul"
      appear
      class="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
      :css="false"
      @enter="listEnter"
    >
      <li v-for="(p, index) in visible" :key="p.id" :data-index="index">
        <button
          type="button"
          class="card group relative flex h-full w-full flex-col overflow-hidden p-5 text-left transition-shadow hover:shadow-pop"
          @click="router.push(`/projects/${p.id}`)"
        >
          <span class="absolute inset-x-0 top-0 h-1" :style="{ background: p.color }" />
          <div class="flex w-full items-start justify-between gap-3">
            <div class="min-w-0">
              <p class="truncate font-semibold text-ink group-hover:text-accent-ink">
                {{ p.name }}
              </p>
              <p class="truncate text-[13px] text-faint">{{ p.client?.name ?? 'Internal' }}</p>
            </div>
            <div class="flex shrink-0 gap-1.5">
              <StatusBadge v-if="p.archivedAt" tone="neutral">Archived</StatusBadge>
              <StatusBadge v-if="activity.onProject(p.id).length" tone="success" dot
                >{{ activity.onProject(p.id).length }} live</StatusBadge
              >
            </div>
          </div>
          <div class="mt-auto w-full pt-6">
            <BudgetBar
              :used-seconds="usage[p.id]?.totalSeconds ?? 0"
              :budget-hours="p.budgetHours ?? null"
              :highlight-seconds="usage[p.id]?.weekSeconds ?? 0"
            />
            <p class="mt-2 text-xs text-faint">
              <span class="num">{{ hoursLabel(usage[p.id]?.weekSeconds ?? 0) }}</span> this week ·
              {{ p.isBillable ? 'Billable' : 'Non-billable' }}
            </p>
          </div>
        </button>
      </li>
    </TransitionGroup>

    <ProjectFormModal
      v-if="isAdmin"
      v-model:open="creating"
      @saved="(p) => router.push(`/projects/${p.id}`)"
    />
  </div>
</template>
