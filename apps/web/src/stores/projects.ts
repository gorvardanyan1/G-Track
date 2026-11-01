import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ProjectResponse, TaskResponse } from '@tempo/shared';
import { projectsApi } from '../api/projects.ts';

/** Projects the user can see, and their tasks (loaded lazily, cached). */
export const useProjectsStore = defineStore('projects', () => {
  const projects = ref<ProjectResponse[]>([]);
  const tasks = ref<Record<string, TaskResponse[]>>({});
  const loaded = ref(false);
  let loading: Promise<void> | null = null;

  function load(force = false): Promise<void> {
    if (loaded.value && !force) return Promise.resolve();
    loading ??= projectsApi
      .list()
      .then((list) => {
        projects.value = list;
        loaded.value = true;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  }

  async function loadTasks(projectId: string): Promise<TaskResponse[]> {
    const cached = tasks.value[projectId];
    if (cached) return cached;
    const list = await projectsApi.tasks(projectId);
    tasks.value = { ...tasks.value, [projectId]: list };
    return list;
  }

  /** Projects one can track time on: assigned and not archived. */
  const trackable = computed(() =>
    projects.value.filter((p) => p.archivedAt === null && p.access !== 'admin'),
  );

  return {
    projects,
    tasks,
    loaded,
    trackable,
    load,
    loadTasks,
    /** Tasks of every trackable project, for searching across them. */
    loadAllTasks: () => Promise.all(trackable.value.map((p) => loadTasks(p.id))),
    byId: (id: string | null) => projects.value.find((p) => p.id === id) ?? null,
    reset: () => {
      projects.value = [];
      tasks.value = {};
      loaded.value = false;
    },
  };
});
