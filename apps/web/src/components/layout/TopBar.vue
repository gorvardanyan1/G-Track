<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { tracksTime } from '../../router/navigation.ts';
import { useAuthStore } from '../../stores/auth.ts';
import { useClockStore } from '../../stores/clock.ts';
import { useRealtimeStore } from '../../stores/realtime.ts';
import { useUiStore } from '../../stores/ui.ts';
import AppIcon from '../ui/AppIcon.vue';
import IconButton from '../ui/IconButton.vue';
import TimerBar from '../tracking/TimerBar.vue';
import UserMenu from './UserMenu.vue';

const auth = useAuthStore();
const ui = useUiStore();
const clock = useClockStore();
const realtime = useRealtimeStore();
const route = useRoute();
const timerBar = ref<InstanceType<typeof TimerBar> | null>(null);
const showTimer = computed(() => tracksTime(auth.role));
const skewMinutes = computed(() => Math.round(Math.abs(clock.offsetMs) / 60_000));

defineExpose({ toggleTimer: () => timerBar.value?.toggle() });
</script>

<template>
  <header
    class="sticky top-0 z-30 border-b border-line bg-bg/80 backdrop-blur-xl backdrop-saturate-150"
  >
    <div class="flex h-16 items-center gap-3 px-4 lg:px-8">
      <IconButton
        icon="sidebar"
        label="Open navigation"
        class="lg:hidden"
        @click="ui.mobileNavOpen = true"
      />
      <TimerBar v-if="showTimer" ref="timerBar" />
      <h1 v-else class="flex-1 text-[15px] font-semibold tracking-tight text-ink">
        {{ route.meta.title }}
      </h1>

      <div class="flex shrink-0 items-center gap-1.5">
        <span
          v-if="clock.skewed"
          class="hidden items-center gap-1.5 rounded-full bg-warning-soft px-2.5 py-1 text-xs font-medium text-warning md:inline-flex"
          :title="`This device’s clock is about ${skewMinutes} min off. Tracking still uses the server’s time.`"
        >
          <AppIcon name="clock" :size="13" /> Clock off by {{ skewMinutes }} min
        </span>
        <span
          v-if="realtime.status !== 'online'"
          class="hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-faint sm:inline-flex"
          :title="
            realtime.status === 'connecting'
              ? 'Reconnecting live updates…'
              : 'Live updates are offline'
          "
        >
          <span
            class="size-1.5 rounded-full bg-faint [animation:blink-dot_1.2s_ease-in-out_infinite]"
          />
          {{ realtime.status === 'connecting' ? 'Connecting' : 'Offline' }}
        </span>
        <UserMenu />
      </div>
    </div>
  </header>
</template>
