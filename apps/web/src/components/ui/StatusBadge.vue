<script setup lang="ts">
withDefaults(
  defineProps<{ tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger'; dot?: boolean }>(),
  {
    tone: 'neutral',
  },
);
</script>

<template>
  <span
    class="inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium whitespace-nowrap"
    :class="
      {
        neutral: 'bg-surface-2 text-muted',
        accent: 'bg-accent-soft text-accent-ink',
        success: 'bg-running-soft text-running',
        warning: 'bg-warning-soft text-warning',
        danger: 'bg-danger-soft text-danger',
      }[tone]
    "
  >
    <span v-if="dot" class="size-1.5 rounded-full bg-current" />
    <slot />
  </span>
</template>
