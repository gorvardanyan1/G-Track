<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { gsap } from 'gsap';
import { budgetUsage } from '../../lib/budget.ts';
import { prefersReducedMotion } from '../../lib/motion.ts';
import { hoursLabel } from '../../lib/time.ts';

const props = defineProps<{
  usedSeconds: number;
  budgetHours: number | null;
  /** Shown as a darker segment inside the bar (e.g. this week's share). */
  highlightSeconds?: number;
  compact?: boolean;
}>();

const usage = computed(() => budgetUsage(props.usedSeconds, props.budgetHours));
const width = (seconds: number) =>
  props.budgetHours ? Math.min(100, (seconds / (props.budgetHours * 3600)) * 100) : 0;
const fill = ref<HTMLElement | null>(null);

function animate(from = 0): void {
  if (!fill.value) return;
  gsap.killTweensOf(fill.value);
  const to = width(props.usedSeconds);
  // Live usage grows every second; only real jumps (a reload, a new budget) animate.
  if (prefersReducedMotion() || Math.abs(to - from) < 1) {
    fill.value.style.width = `${to}%`;
    return;
  }
  gsap.fromTo(
    fill.value,
    { width: `${from}%` },
    { width: `${to}%`, duration: 0.6, ease: 'power3.out' },
  );
}
onMounted(() => animate());
watch(
  () => props.usedSeconds,
  (_now, before) => animate(width(before)),
);

const tone = computed(
  () =>
    ({
      none: 'bg-accent',
      ok: 'bg-accent',
      warning: 'bg-warning',
      over: 'bg-danger',
    })[usage.value.tone],
);
</script>

<template>
  <div>
    <div
      v-if="!compact"
      class="mb-1.5 flex items-baseline justify-between gap-3 text-[13px] text-muted"
    >
      <span
        ><span class="num font-medium text-ink">{{ hoursLabel(usedSeconds) }}</span>
        <template v-if="budgetHours !== null">
          of <span class="num">{{ hoursLabel(budgetHours * 3600) }}</span></template
        ><template v-else> tracked · no budget</template></span
      >
      <span
        v-if="usage.percent !== null"
        class="num font-medium"
        :class="{
          'text-ink': usage.tone === 'ok',
          'text-warning': usage.tone === 'warning',
          'text-danger': usage.tone === 'over',
        }"
        >{{ usage.percent }}%</span
      >
    </div>
    <div
      class="relative h-2 overflow-hidden rounded-full bg-surface-3"
      role="progressbar"
      :aria-valuenow="usage.percent ?? undefined"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="budgetHours === null ? 'No budget set' : 'Budget used'"
    >
      <div
        v-if="budgetHours !== null"
        ref="fill"
        class="absolute inset-y-0 left-0 rounded-full"
        :class="tone"
        :style="{ width: `${width(usedSeconds)}%` }"
      />
      <div
        v-if="budgetHours !== null && highlightSeconds"
        class="absolute inset-y-0 rounded-r-full bg-black/20 dark:bg-white/25"
        :style="{
          left: `${width(Math.max(0, usedSeconds - highlightSeconds))}%`,
          width: `${width(usedSeconds) - width(Math.max(0, usedSeconds - highlightSeconds))}%`,
        }"
      />
    </div>
  </div>
</template>
