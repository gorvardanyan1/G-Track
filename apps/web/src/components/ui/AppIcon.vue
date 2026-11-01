<script setup lang="ts">
import { computed } from 'vue';
import { ICONS, type IconName } from './icons.ts';

const props = withDefaults(defineProps<{ name: IconName; size?: number; stroke?: number }>(), {
  size: 18,
  stroke: 1.75,
});

type Shape =
  | { kind: 'path'; d: string }
  | { kind: 'circle'; cx: number; cy: number; r: number }
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx: number };

const shapes = computed<Shape[]>(() =>
  ICONS[props.name].map((spec): Shape => {
    const [kind, ...rest] = spec.split(' ');
    const n = rest.map(Number);
    if (kind === 'c') return { kind: 'circle', cx: n[0] ?? 0, cy: n[1] ?? 0, r: n[2] ?? 0 };
    if (kind === 'r')
      return {
        kind: 'rect',
        x: n[0] ?? 0,
        y: n[1] ?? 0,
        width: n[2] ?? 0,
        height: n[3] ?? 0,
        rx: n[4] ?? 0,
      };
    return { kind: 'path', d: spec };
  }),
);
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="stroke"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <template v-for="(shape, i) in shapes" :key="i">
      <circle v-if="shape.kind === 'circle'" :cx="shape.cx" :cy="shape.cy" :r="shape.r" />
      <rect
        v-else-if="shape.kind === 'rect'"
        :x="shape.x"
        :y="shape.y"
        :width="shape.width"
        :height="shape.height"
        :rx="shape.rx"
      />
      <path v-else :d="shape.d" />
    </template>
  </svg>
</template>
