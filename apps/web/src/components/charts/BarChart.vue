<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { hoursAxisMax } from '../../lib/charts.ts';
import { growIn } from '../../lib/motion.ts';
import { formatDurationHm } from '../../lib/time.ts';

/** Hours per day as bars; hover shows the exact value. */
const props = defineProps<{
  data: readonly {
    key: string;
    label: string;
    sublabel?: string;
    seconds: number;
    highlight?: boolean;
  }[];
}>();
const root = ref<SVGSVGElement | null>(null);
const hovered = ref<number | null>(null);

const W = 640;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 34, left: 34 };
const max = computed(() => hoursAxisMax(Math.max(0, ...props.data.map((d) => d.seconds))));
const ticks = computed(() => {
  const hours = max.value / 3600;
  const step = hours <= 4 ? 1 : hours <= 10 ? 2 : Math.ceil(hours / 5);
  return Array.from({ length: Math.floor(hours / step) + 1 }, (_, i) => i * step * 3600);
});
const band = computed(() => (W - PAD.left - PAD.right) / Math.max(1, props.data.length));
const y = (seconds: number) => PAD.top + (H - PAD.top - PAD.bottom) * (1 - seconds / max.value);

watch(
  () => props.data.map((d) => d.seconds).join(','),
  async () => {
    await nextTick();
    growIn([...(root.value?.querySelectorAll('.bar') ?? [])]);
  },
  { immediate: true },
);
</script>

<template>
  <div class="relative">
    <svg ref="root" :viewBox="`0 0 ${W} ${H}`" class="w-full" role="img" aria-label="Hours per day">
      <g v-for="tick in ticks" :key="tick">
        <line
          :x1="PAD.left"
          :x2="W - PAD.right"
          :y1="y(tick)"
          :y2="y(tick)"
          class="stroke-line"
          stroke-dasharray="3 4"
        />
        <text
          :x="PAD.left - 8"
          :y="y(tick) + 4"
          text-anchor="end"
          class="fill-faint num text-[10px]"
        >
          {{ tick / 3600 }}h
        </text>
      </g>
      <g
        v-for="(d, i) in data"
        :key="d.key"
        @pointerenter="hovered = i"
        @pointerleave="hovered = null"
      >
        <rect
          :x="PAD.left + i * band"
          :y="PAD.top"
          :width="band"
          :height="H - PAD.top - PAD.bottom"
          fill="transparent"
        />
        <rect
          class="bar transition-opacity"
          :x="PAD.left + i * band + band * 0.2"
          :y="y(d.seconds)"
          :width="band * 0.6"
          :height="Math.max(0, H - PAD.bottom - y(d.seconds))"
          rx="5"
          :class="d.highlight ? 'fill-accent' : 'fill-accent/70'"
          :opacity="hovered === null || hovered === i ? 1 : 0.45"
        />
        <text
          :x="PAD.left + i * band + band / 2"
          :y="H - PAD.bottom + 16"
          text-anchor="middle"
          class="text-[11px]"
          :class="d.highlight ? 'fill-ink font-semibold' : 'fill-muted'"
        >
          {{ d.label }}
        </text>
        <text
          v-if="d.sublabel"
          :x="PAD.left + i * band + band / 2"
          :y="H - PAD.bottom + 29"
          text-anchor="middle"
          class="fill-faint text-[10px]"
        >
          {{ d.sublabel }}
        </text>
      </g>
    </svg>
    <Transition name="fade">
      <div
        v-if="hovered !== null && data[hovered]"
        class="pointer-events-none absolute top-0 -translate-x-1/2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-pop"
        :style="{ left: `${((PAD.left + (hovered + 0.5) * band) / W) * 100}%` }"
      >
        <span class="text-muted">{{ data[hovered]?.label }} {{ data[hovered]?.sublabel }}</span>
        <span class="num ml-2 font-medium text-ink">{{
          formatDurationHm(data[hovered]?.seconds ?? 0)
        }}</span>
      </div>
    </Transition>
  </div>
</template>
