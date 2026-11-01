<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import {
  projectPermissions,
  type MemberResponse,
  type ProjectResponse,
  type ProjectUsageDetailResponse,
  type TaskResponse,
} from '@tempo/shared';
import { ApiError } from '../../api/client.ts';
import { projectsApi } from '../../api/projects.ts';
import StatCard from '../../components/charts/StatCard.vue';
import ProjectFormModal from '../../components/admin/ProjectFormModal.vue';
import BudgetBar from '../../components/manage/BudgetBar.vue';
import MembersPanel from '../../components/manage/MembersPanel.vue';
import TasksPanel from '../../components/manage/TasksPanel.vue';
import WorkingNowList from '../../components/manage/WorkingNowList.vue';
import AppIcon from '../../components/ui/AppIcon.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import BaseModal from '../../components/ui/BaseModal.vue';
import ConfirmDialog from '../../components/ui/ConfirmDialog.vue';
import EmptyState from '../../components/ui/EmptyState.vue';
import SkeletonBlock from '../../components/ui/SkeletonBlock.vue';
import StatusBadge from '../../components/ui/StatusBadge.vue';
import TextField from '../../components/ui/TextField.vue';
import { budgetUsage } from '../../lib/budget.ts';
import { liveExtraSeconds } from '../../lib/live-usage.ts';
import { formatDurationHm, hoursLabel } from '../../lib/time.ts';
import { useActivityStore } from '../../stores/activity.ts';
import { useAuthStore } from '../../stores/auth.ts';
import { useClockStore } from '../../stores/clock.ts';
import { useProjectsStore } from '../../stores/projects.ts';
import { optionalNumber } from '../../lib/number.ts';
import { useToastStore } from '../../stores/toasts.ts';

const route = useRoute();
const auth = useAuthStore();
const clock = useClockStore();
const activity = useActivityStore();
const projectsStore = useProjectsStore();
const toasts = useToastStore();
const zone = computed(() => auth.user?.timezone ?? 'UTC');
const id = computed(() => String(route.params['id']));

const project = ref<ProjectResponse | null>(null);
const usage = ref<ProjectUsageDetailResponse | null>(null);
const fetchedAtMs = ref(0);
const members = ref<MemberResponse[] | null>(null);
const tasks = ref<TaskResponse[] | null>(null);
const missing = ref(false);

async function loadProject(): Promise<void> {
  try {
    project.value = await projectsApi.get(id.value);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) missing.value = true;
    else toasts.error(e, 'Could not load the project');
  }
}
async function loadUsage(): Promise<void> {
  const next = await projectsApi.projectUsage(id.value).catch(() => null);
  fetchedAtMs.value = clock.serverNowMs;
  usage.value = next;
}
async function loadMembers(): Promise<void> {
  members.value = await projectsApi.members(id.value).catch(() => []);
  void loadUsage();
}
async function loadTasks(): Promise<void> {
  tasks.value = await projectsApi.tasks(id.value).catch(() => []);
}
watch(
  id,
  async () => {
    project.value = usage.value = members.value = tasks.value = null;
    missing.value = false;
    await loadProject();
    if (project.value) void Promise.all([loadUsage(), loadMembers(), loadTasks()]);
  },
  { immediate: true },
);

const access = computed(() => project.value?.access ?? 'member');
const archived = computed(() => (project.value?.archivedAt ?? null) !== null);
const isAdmin = computed(() => access.value === 'admin');
const running = computed(() => activity.onProject(id.value));
const live = computed(() =>
  liveExtraSeconds(
    running.value.map((r) => r.entry.startedAt),
    fetchedAtMs.value,
    clock.serverNowMs,
  ),
);
const total = computed(() => (usage.value?.totalSeconds ?? 0) + live.value);
const week = computed(() => (usage.value?.weekSeconds ?? 0) + live.value);
const budget = computed(() => budgetUsage(total.value, project.value?.budgetHours ?? null));

// Live timers change the totals for good when they stop: reload then.
watch(
  () => running.value.map((r) => r.entry.id).join(),
  () => void loadUsage(),
);

// ─── budget (PMs and admins) ─────────────────────────────────────────────────
const budgetOpen = ref(false);
const budgetDraft = ref<string | number>('');
const budgetError = ref<string | null>(null);
const savingBudget = ref(false);
function editBudget(): void {
  budgetDraft.value = String(project.value?.budgetHours ?? '');
  budgetError.value = null;
  budgetOpen.value = true;
}
async function saveBudget(): Promise<void> {
  const budgetHours = optionalNumber(budgetDraft.value);
  if (budgetHours !== null && !(budgetHours > 0)) {
    budgetError.value = 'Use a positive number of hours, or leave it empty for no budget';
    return;
  }
  savingBudget.value = true;
  try {
    project.value = await projectsApi.update(id.value, { budgetHours });
    budgetOpen.value = false;
    toasts.success('Budget updated');
  } catch (e) {
    toasts.error(e, 'Could not update the budget');
  } finally {
    savingBudget.value = false;
  }
}

// ─── admin: edit / archive ───────────────────────────────────────────────────
const editing = ref(false);
const archiveOpen = ref(false);
const archiving = ref(false);
async function toggleArchived(): Promise<void> {
  archiving.value = true;
  try {
    project.value = await projectsApi.setArchived(id.value, !archived.value);
    archiveOpen.value = false;
    toasts.success(archived.value ? 'Project archived' : 'Project restored');
    void projectsStore.load(true);
  } catch (e) {
    toasts.error(e, 'Could not change the project');
  } finally {
    archiving.value = false;
  }
}
function saved(p: ProjectResponse): void {
  project.value = p;
  void projectsStore.load(true);
}
const hm = (s: number) => formatDurationHm(s);
</script>

<template>
  <div>
    <RouterLink
      to="/projects"
      class="mb-4 inline-flex items-center gap-1 text-[13px] text-muted hover:text-ink"
      ><AppIcon name="chevron-left" :size="14" /> Projects</RouterLink
    >

    <div v-if="missing" class="card">
      <EmptyState
        art="compass"
        title="Project not found"
        description="It doesn’t exist, or you don’t manage it."
      />
    </div>

    <template v-else>
      <div class="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div v-if="project" class="flex items-start gap-3">
          <span class="mt-1.5 h-6 w-1.5 rounded-full" :style="{ background: project.color }" />
          <div>
            <h1 class="flex items-center gap-3 text-2xl font-semibold tracking-tight text-ink">
              {{ project.name }}
              <StatusBadge v-if="archived">Archived</StatusBadge>
            </h1>
            <p class="mt-1 text-sm text-muted">
              {{ project.client?.name ?? 'Internal project' }} ·
              {{ project.isBillable ? 'Billable' : 'Non-billable' }}
            </p>
          </div>
        </div>
        <div v-else>
          <SkeletonBlock width="220px" height="1.6rem" /><SkeletonBlock
            width="140px"
            class="mt-2"
          />
        </div>
        <div v-if="project && isAdmin" class="flex gap-2">
          <BaseButton v-if="!archived" icon="pencil" @click="editing = true">Edit</BaseButton>
          <BaseButton :variant="archived ? 'secondary' : 'ghost'" @click="archiveOpen = true">{{
            archived ? 'Restore' : 'Archive'
          }}</BaseButton>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total tracked" icon="clock" :value="total" :format="hm" />
        <StatCard
          label="This week"
          icon="calendar"
          :value="week"
          :format="hm"
          :hint="running.length ? `${running.length} tracking now` : undefined"
        />
        <StatCard
          label="Budget left"
          icon="chart"
          :value="Math.max(0, budget.remainingSeconds ?? 0)"
          :format="(s) => (budget.remainingSeconds === null ? '—' : hm(s))"
          :hint="
            budget.remainingSeconds === null
              ? 'No budget set'
              : budget.tone === 'over'
                ? `${hm(-budget.remainingSeconds)} over budget`
                : `${budget.percent}% used`
          "
        />
        <StatCard
          label="Members"
          icon="users"
          :value="members?.length ?? 0"
          :format="(n) => String(n)"
        />
      </div>

      <div class="mt-6 grid gap-6 lg:grid-cols-[1.6fr_1fr]">
        <div class="space-y-6">
          <section class="card p-5">
            <div class="mb-4 flex items-center justify-between">
              <h2 class="text-sm font-semibold text-ink">Budget</h2>
              <BaseButton
                v-if="project && !archived && projectPermissions.editBudget(access)"
                size="sm"
                variant="ghost"
                icon="pencil"
                @click="editBudget"
                >Edit budget</BaseButton
              >
            </div>
            <BudgetBar
              v-if="project && usage"
              :used-seconds="total"
              :budget-hours="project.budgetHours ?? null"
              :highlight-seconds="week"
            />
            <SkeletonBlock v-else height="34px" />
            <p v-if="usage" class="mt-3 text-xs text-faint">
              The darker part is this week ({{ hoursLabel(week) }}). Running timers count as they
              go.
            </p>
          </section>
          <MembersPanel
            v-if="project"
            :project-id="id"
            :access="access"
            :archived="archived"
            :members="members"
            :usage="usage"
            @changed="loadMembers"
          />
        </div>
        <div class="space-y-6">
          <section class="card overflow-hidden">
            <h2 class="border-b border-line px-5 py-4 text-sm font-semibold text-ink">
              Working now
            </h2>
            <WorkingNowList :items="running" :zone="zone" :loading="!activity.received" />
          </section>
          <TasksPanel
            v-if="project"
            :project-id="id"
            :tasks="tasks"
            :can-manage="!archived && projectPermissions.manageTasks(access)"
            @changed="loadTasks"
          />
        </div>
      </div>
    </template>

    <BaseModal v-model:open="budgetOpen" title="Project budget" size="sm">
      <form id="budget-form" @submit.prevent="saveBudget">
        <TextField
          v-model="budgetDraft"
          label="Budget (hours)"
          type="number"
          min="0"
          step="0.25"
          placeholder="No budget"
          :error="budgetError"
          autofocus
        />
      </form>
      <template #footer>
        <BaseButton variant="ghost" @click="budgetOpen = false">Cancel</BaseButton>
        <BaseButton variant="primary" type="submit" form="budget-form" :loading="savingBudget"
          >Save</BaseButton
        >
      </template>
    </BaseModal>
    <ProjectFormModal v-if="isAdmin" v-model:open="editing" :project="project" @saved="saved" />
    <ConfirmDialog
      v-model:open="archiveOpen"
      :title="archived ? 'Restore this project?' : 'Archive this project?'"
      :confirm-label="archived ? 'Restore' : 'Archive'"
      :tone="archived ? 'primary' : 'danger'"
      :loading="archiving"
      @confirm="toggleArchived"
    >
      <template v-if="archived">People on it can track time on it again.</template>
      <template v-else
        >Nobody can track new time on it. Its entries and reports stay; you can restore it any
        time.</template
      >
    </ConfirmDialog>
  </div>
</template>
