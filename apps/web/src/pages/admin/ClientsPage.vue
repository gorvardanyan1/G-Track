<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { ClientResponse, ProjectResponse } from '@tempo/shared';
import { ApiError } from '../../api/client.ts';
import { clientsApi } from '../../api/clients.ts';
import { projectsApi } from '../../api/projects.ts';
import ProjectFormModal from '../../components/admin/ProjectFormModal.vue';
import AppIcon from '../../components/ui/AppIcon.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import BaseModal from '../../components/ui/BaseModal.vue';
import EmptyState from '../../components/ui/EmptyState.vue';
import IconButton from '../../components/ui/IconButton.vue';
import SkeletonBlock from '../../components/ui/SkeletonBlock.vue';
import StatusBadge from '../../components/ui/StatusBadge.vue';
import TextField from '../../components/ui/TextField.vue';
import ToggleSwitch from '../../components/ui/ToggleSwitch.vue';
import { listEnter } from '../../lib/motion.ts';
import { useProjectsStore } from '../../stores/projects.ts';
import { useToastStore } from '../../stores/toasts.ts';

const toasts = useToastStore();
const projectsStore = useProjectsStore();
const clients = ref<ClientResponse[] | null>(null);
const projects = ref<ProjectResponse[]>([]);
const showArchived = ref(false);

async function load(): Promise<void> {
  try {
    [clients.value, projects.value] = await Promise.all([
      clientsApi.list(),
      projectsApi.list(true),
    ]);
  } catch (e) {
    toasts.error(e, 'Could not load clients');
  }
}
onMounted(load);

interface Group {
  client: ClientResponse | null;
  projects: ProjectResponse[];
}
const groups = computed<Group[]>(() => {
  const list = (clients.value ?? []).filter((c) => showArchived.value || c.archivedAt === null);
  const of = (clientId: string | null) =>
    projects.value.filter(
      (p) => (p.client?.id ?? null) === clientId && (showArchived.value || p.archivedAt === null),
    );
  return [
    ...list.map((client) => ({ client, projects: of(client.id) })),
    { client: null, projects: of(null) },
  ];
});

// ─── client name (create / rename) ───────────────────────────────────────────
const nameOpen = ref(false);
const editingClient = ref<ClientResponse | null>(null);
const clientName = ref('');
const nameError = ref<string | null>(null);
const saving = ref(false);
function editName(client: ClientResponse | null): void {
  editingClient.value = client;
  clientName.value = client?.name ?? '';
  nameError.value = null;
  nameOpen.value = true;
}
async function saveName(): Promise<void> {
  if (!clientName.value.trim()) {
    nameError.value = 'Give the client a name';
    return;
  }
  saving.value = true;
  try {
    if (editingClient.value)
      await clientsApi.rename(editingClient.value.id, clientName.value.trim());
    else await clientsApi.create(clientName.value.trim());
    toasts.success(
      editingClient.value ? 'Client renamed' : 'Client added',
      clientName.value.trim(),
    );
    nameOpen.value = false;
    await load();
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) nameError.value = e.message;
    else toasts.error(e, 'Could not save the client');
  } finally {
    saving.value = false;
  }
}
async function toggleArchived(client: ClientResponse): Promise<void> {
  try {
    await clientsApi.setArchived(client.id, client.archivedAt === null);
    toasts.success(client.archivedAt === null ? 'Client archived' : 'Client restored', client.name);
    await load();
  } catch (e) {
    toasts.error(e, 'Could not change the client');
  }
}

// ─── projects ────────────────────────────────────────────────────────────────
const projectOpen = ref(false);
const projectClient = ref<string | null>(null);
function newProject(clientId: string | null): void {
  projectClient.value = clientId;
  projectOpen.value = true;
}
async function projectSaved(): Promise<void> {
  await load();
  void projectsStore.load(true);
}
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Clients &amp; projects</h1>
        <p class="mt-1 text-sm text-muted">
          Who the work is for. Open a project to assign its project manager and team.
        </p>
      </div>
      <div class="flex items-center gap-3">
        <ToggleSwitch v-model="showArchived">Archived</ToggleSwitch>
        <BaseButton icon="plus" @click="newProject(null)">New project</BaseButton>
        <BaseButton variant="primary" icon="plus" @click="editName(null)">New client</BaseButton>
      </div>
    </div>

    <div v-if="!clients" class="space-y-4">
      <div v-for="i in 3" :key="i" class="card p-5">
        <SkeletonBlock width="30%" /><SkeletonBlock width="60%" class="mt-4" />
      </div>
    </div>
    <div
      v-else-if="groups.every((g) => g.projects.length === 0) && clients.length === 0"
      class="card"
    >
      <EmptyState
        art="compass"
        title="No clients yet"
        description="Add a client, then create projects for it. Internal projects need no client."
      />
    </div>
    <TransitionGroup v-else tag="div" appear class="space-y-4" :css="false" @enter="listEnter">
      <section
        v-for="(group, index) in groups"
        v-show="group.client || group.projects.length"
        :key="group.client?.id ?? 'internal'"
        :data-index="index"
        class="card"
        :class="group.client?.archivedAt && 'opacity-70'"
      >
        <header class="flex flex-wrap items-center justify-between gap-3 px-5 pt-4 pb-3">
          <div class="flex min-w-0 items-center gap-3">
            <span
              class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted"
            >
              <AppIcon :name="group.client ? 'briefcase' : 'home'" :size="17" />
            </span>
            <div class="min-w-0">
              <h2 class="flex items-center gap-2 truncate font-semibold text-ink">
                {{ group.client?.name ?? 'Internal' }}
                <StatusBadge v-if="group.client?.archivedAt">Archived</StatusBadge>
              </h2>
              <p class="text-xs text-faint">
                {{ group.projects.length }}
                {{ group.projects.length === 1 ? 'project' : 'projects' }}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-1">
            <BaseButton
              v-if="!group.client?.archivedAt"
              size="sm"
              variant="ghost"
              icon="plus"
              @click="newProject(group.client?.id ?? null)"
              >Project</BaseButton
            >
            <template v-if="group.client">
              <IconButton
                icon="pencil"
                size="sm"
                label="Rename client"
                @click="editName(group.client)"
              />
              <IconButton
                :icon="group.client.archivedAt ? 'refresh' : 'trash'"
                size="sm"
                :tone="group.client.archivedAt ? 'default' : 'danger'"
                :label="group.client.archivedAt ? 'Restore client' : 'Archive client'"
                @click="toggleArchived(group.client)"
              />
            </template>
          </div>
        </header>
        <ul v-if="group.projects.length" class="flex flex-wrap gap-2 px-5 pb-5">
          <li v-for="p in group.projects" :key="p.id">
            <RouterLink
              :to="`/projects/${p.id}`"
              class="flex h-9 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-sm text-ink transition-colors hover:border-line-strong hover:bg-surface-2"
              :class="p.archivedAt && 'text-faint'"
            >
              <span class="size-2.5 rounded-full" :style="{ background: p.color }" />
              {{ p.name }}
              <span v-if="p.budgetHours" class="num text-xs text-faint">{{ p.budgetHours }} h</span>
              <span v-if="p.archivedAt" class="text-xs">· archived</span>
            </RouterLink>
          </li>
        </ul>
        <p v-else class="px-5 pb-5 text-sm text-faint">No projects yet.</p>
      </section>
    </TransitionGroup>

    <BaseModal
      v-model:open="nameOpen"
      :title="editingClient ? 'Rename client' : 'New client'"
      size="sm"
    >
      <form id="client-form" @submit.prevent="saveName">
        <TextField v-model="clientName" label="Name" maxlength="120" :error="nameError" autofocus />
      </form>
      <template #footer>
        <BaseButton variant="ghost" @click="nameOpen = false">Cancel</BaseButton>
        <BaseButton variant="primary" type="submit" form="client-form" :loading="saving">{{
          editingClient ? 'Save' : 'Add client'
        }}</BaseButton>
      </template>
    </BaseModal>
    <ProjectFormModal
      v-model:open="projectOpen"
      :default-client-id="projectClient"
      @saved="projectSaved"
    />
  </div>
</template>
