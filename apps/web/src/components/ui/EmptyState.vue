<script setup lang="ts">
withDefaults(
  defineProps<{
    title: string;
    description?: string;
    art?: 'clock' | 'calendar' | 'chart' | 'compass';
  }>(),
  {
    art: 'clock',
  },
);
</script>

<template>
  <div class="flex flex-col items-center px-6 py-14 text-center">
    <!-- Soft, theme-aware illustration: layered shapes in accent tints. -->
    <svg width="132" height="104" viewBox="0 0 132 104" fill="none" aria-hidden="true" class="mb-5">
      <ellipse cx="66" cy="94" rx="44" ry="6" class="fill-surface-3" />
      <rect
        x="22"
        y="14"
        width="88"
        height="70"
        rx="16"
        class="fill-surface stroke-line"
        stroke-width="1.5"
      />
      <rect x="34" y="28" width="38" height="6" rx="3" class="fill-surface-3" />
      <rect x="34" y="40" width="58" height="6" rx="3" class="fill-surface-3" />
      <template v-if="art === 'clock'">
        <circle cx="92" cy="64" r="20" class="fill-accent-soft stroke-accent" stroke-width="2" />
        <path
          d="M92 54v10l6 4"
          class="stroke-accent"
          stroke-width="2.5"
          stroke-linecap="round"
          stroke-linejoin="round"
        />
      </template>
      <template v-else-if="art === 'calendar'">
        <rect
          x="74"
          y="48"
          width="38"
          height="34"
          rx="8"
          class="fill-accent-soft stroke-accent"
          stroke-width="2"
        />
        <path
          d="M74 58h38M84 44v8M102 44v8"
          class="stroke-accent"
          stroke-width="2.5"
          stroke-linecap="round"
        />
      </template>
      <template v-else-if="art === 'chart'">
        <rect
          x="76"
          y="44"
          width="36"
          height="38"
          rx="8"
          class="fill-accent-soft stroke-accent"
          stroke-width="2"
        />
        <path
          d="M85 74v-8M94 74V56M103 74v-12"
          class="stroke-accent"
          stroke-width="3"
          stroke-linecap="round"
        />
      </template>
      <template v-else>
        <circle cx="92" cy="64" r="20" class="fill-accent-soft stroke-accent" stroke-width="2" />
        <path d="m86 70 3.5-9.5L99 57l-3.5 9.5z" class="fill-accent" />
      </template>
      <circle cx="30" cy="12" r="3" class="fill-accent" opacity="0.35" />
      <circle cx="118" cy="30" r="2" class="fill-accent" opacity="0.5" />
    </svg>
    <h3 class="text-[15px] font-semibold text-ink">{{ title }}</h3>
    <p v-if="description" class="mt-1.5 max-w-sm text-sm text-muted">{{ description }}</p>
    <div v-if="$slots['default']" class="mt-5"><slot /></div>
  </div>
</template>
