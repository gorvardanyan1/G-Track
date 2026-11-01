<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { gsap } from 'gsap';
import { donutSegment, segmentAngles } from '../../lib/charts.ts';
import { prefersReducedMotion } from '../../lib/motion.ts';
import { formatDurationHm } from '../../lib/time.ts';

/** Share of time per project, with a legend. */
const props = defineProps<{
  segments: readonly { key: string; label: string; color: string; seconds: number }[];
}>();
const group = ref<SVGGElement | null>(null);
const hovered = ref<string | null>(null);
const total = computed(() => props.segments.reduce((a, s) => a + s.seconds, 0));
const arcs = computed(() => {
  const angles = segmentAngles(props.segments.map((s) => s.seconds));
  return props.segments.map((s, i) => ({
    ...s,
    d: donutSegment(80, 80, 76, 52, angles[i]?.from ?? 0, angles[i]?.to ?? 0),
  }));
});
const center = computed(() => props.segments.find((s) => s.key === hovered.value));
const pct = (seconds: number) => (total.value ? Math.round((seconds / total.value) * 100) : 0);

watch(
  () => props.segments.map((s) => s.seconds).join(','),
  async () => {
    await nextTick();
    if (group.value && !prefersReducedMotion())
      gsap.from(group.value, {
        rotate: -90,
        scale: 0.85,
        opacity: 0,
        transformOrigin: '80px 80px',
        duration: 0.6,
        ease: 'power3.out',
      });
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
    <svg viewBox="0 0 160 160" class="size-40 shrink-0" role="img" aria-label="Time by project">
      <circle cx="80" cy="80" r="64" fill="none" class="stroke-surface-2" stroke-width="24" />
      <g ref="group">
        <path
          v-for="arc in arcs"
          :key="arc.key"
          :d="arc.d"
          :fill="arc.color"
          class="cursor-pointer transition-opacity"
          :opacity="hovered === null || hovered === arc.key ? 1 : 0.35"
          @pointerenter="hovered = arc.key"
          @pointerleave="hovered = null"
        />
      </g>
      <text x="80" y="77" text-anchor="middle" class="num fill-ink text-[17px] font-semibold">
        {{ formatDurationHm(center?.seconds ?? total) }}
      </text>
      <text x="80" y="95" text-anchor="middle" class="fill-faint text-[10px]">
        {{ center ? `${pct(center.seconds)}%` : 'total' }}
      </text>
    </svg>
    <ul class="w-full min-w-0 flex-1 space-y-1">
      <li
        v-for="s in segments"
        :key="s.key"
        class="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm transition-colors"
        :class="hovered === s.key && 'bg-surface-2'"
        @pointerenter="hovered = s.key"
        @pointerleave="hovered = null"
      >
        <span class="size-2.5 shrink-0 rounded-[3px]" :style="{ background: s.color }" />
        <span class="min-w-0 flex-1 truncate text-ink">{{ s.label }}</span>
        <span class="num text-muted">{{ formatDurationHm(s.seconds) }}</span>
        <span class="num w-10 text-right text-xs text-faint">{{ pct(s.seconds) }}%</span>
      </li>
    </ul>
  </div>
</template>
