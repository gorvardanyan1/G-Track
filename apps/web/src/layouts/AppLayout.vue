<script setup lang="ts">
import { computed, ref, watchEffect } from 'vue';
import { useRoute } from 'vue-router';
import AppSidebar from '../components/layout/AppSidebar.vue';
import TimezoneBanner from '../components/layout/TimezoneBanner.vue';
import TopBar from '../components/layout/TopBar.vue';
import ManualEntryModal from '../components/tracking/ManualEntryModal.vue';
import { useHotkeys } from '../composables/useHotkeys.ts';
import { formatDuration } from '../lib/time.ts';
import { tracksTime } from '../router/navigation.ts';
import { useAuthStore } from '../stores/auth.ts';
import { useTimerStore } from '../stores/timer.ts';
import { useUiStore } from '../stores/ui.ts';

const auth = useAuthStore();
const timer = useTimerStore();
const ui = useUiStore();
const route = useRoute();
const topBar = ref<InstanceType<typeof TopBar> | null>(null);
const tracks = computed(() => tracksTime(auth.role));

useHotkeys({
  s: () => tracks.value && topBar.value?.toggleTimer(),
  n: () => tracks.value && ui.openManualEntry(),
});

// The tab shows the running time, so it is visible from any other tab.
watchEffect(() => {
  const page = route.meta.title ? `${route.meta.title} · TEMPO` : 'TEMPO';
  const running = timer.running;
  document.title = running
    ? `${formatDuration(timer.elapsed)} · ${running.project.name}${running.description ? ` – ${running.description}` : ''}`
    : page;
});
</script>

<template>
  <div class="flex min-h-dvh">
    <AppSidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <TopBar ref="topBar" />
      <TimezoneBanner />
      <main class="mx-auto w-full max-w-[1240px] flex-1 px-4 py-6 lg:px-8 lg:py-8">
        <RouterView v-slot="{ Component, route: r }">
          <Transition name="page" mode="out-in">
            <component :is="Component" :key="r.path" />
          </Transition>
        </RouterView>
      </main>
    </div>
    <ManualEntryModal
      v-if="tracks"
      v-model:open="ui.manualEntry.open"
      :prefill="ui.manualEntry.prefill"
    />
  </div>
</template>
