<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import type { IconName } from './icons.ts';

withDefaults(
  defineProps<{ icon: IconName; label: string; size?: 'sm' | 'md'; tone?: 'default' | 'danger' }>(),
  {
    size: 'md',
    tone: 'default',
  },
);
</script>

<template>
  <button
    type="button"
    :aria-label="label"
    :title="label"
    class="inline-flex shrink-0 items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-surface-2 disabled:opacity-40"
    :class="[
      size === 'sm' ? 'size-7' : 'size-9',
      tone === 'danger' ? 'hover:text-danger' : 'hover:text-ink',
    ]"
  >
    <AppIcon :name="icon" :size="size === 'sm' ? 15 : 18" />
  </button>
</template>
