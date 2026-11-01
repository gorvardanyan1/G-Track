<script setup lang="ts">
import { listEnter, listLeave } from '../../lib/motion.ts';
import { formatDuration, timeOf } from '../../lib/time.ts';
import { useClockStore } from '../../stores/clock.ts';
import type { WorkingNow } from '../../stores/activity.ts';
import ProjectDot from '../ui/ProjectDot.vue';
import SkeletonBlock from '../ui/SkeletonBlock.vue';
import UserAvatar from '../ui/UserAvatar.vue';

defineProps<{ items: readonly WorkingNow[]; loading?: boolean; zone: string }>();
const clock = useClockStore();
</script>

<template>
  <div>
    <ul v-if="loading" class="divide-y divide-line">
      <li v-for="i in 3" :key="i" class="flex items-center gap-3 px-5 py-3.5">
        <SkeletonBlock width="32px" height="32px" class="rounded-full" />
        <div class="flex-1">
          <SkeletonBlock width="40%" /><SkeletonBlock width="60%" class="mt-2" />
        </div>
      </li>
    </ul>
    <p v-else-if="items.length === 0" class="px-5 py-10 text-center text-sm text-faint">
      Nobody is tracking right now.
    </p>
    <TransitionGroup
      v-else
      tag="ul"
      class="divide-y divide-line"
      :css="false"
      @enter="listEnter"
      @leave="listLeave"
    >
      <li
        v-for="(item, index) in items"
        :key="item.user.id"
        :data-index="index"
        class="flex items-center gap-3 px-5 py-3.5"
      >
        <div class="relative">
          <UserAvatar :name="item.user.name" />
          <span
            class="absolute -right-0.5 -bottom-0.5 flex size-3 items-center justify-center rounded-full bg-surface"
            ><span class="live-dot size-2 rounded-full bg-running"
          /></span>
        </div>
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm font-medium text-ink">{{ item.user.name }}</p>
          <p class="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
            <ProjectDot :color="item.entry.project.color" />
            <span class="truncate"
              >{{ item.entry.project.name
              }}<template v-if="item.entry.task"> · {{ item.entry.task.name }}</template
              ><template v-if="item.entry.description">
                — {{ item.entry.description }}</template
              ></span
            >
          </p>
        </div>
        <div class="text-right">
          <p class="num text-sm font-semibold text-running">
            {{ formatDuration(clock.elapsed(item.entry.startedAt)) }}
          </p>
          <p class="num text-xs text-faint">since {{ timeOf(item.entry.startedAt, zone) }}</p>
        </div>
      </li>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.live-dot {
  animation: live 1.8s ease-in-out infinite;
}
@keyframes live {
  50% {
    opacity: 0.45;
  }
}
@media (prefers-reduced-motion: reduce) {
  .live-dot {
    animation: none;
  }
}
</style>
