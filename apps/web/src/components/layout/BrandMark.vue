<script setup lang="ts">
withDefaults(defineProps<{ tone?: 'default' | 'light'; compact?: boolean }>(), { tone: 'default' });
</script>

<template>
  <div class="flex items-center gap-2.5">
    <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" class="shrink-0">
      <rect width="32" height="32" rx="9" fill="#5B5BF7" />
      <circle cx="16" cy="17" r="8.5" fill="none" stroke="#fff" stroke-width="2.6" />
      <path
        d="M16 12.5V17l3 2"
        fill="none"
        stroke="#fff"
        stroke-width="2.6"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
      <path d="M13 6.5h6" stroke="#fff" stroke-width="2.6" stroke-linecap="round" />
    </svg>
    <span
      v-if="!compact"
      class="text-[15px] font-semibold tracking-[0.18em]"
      :class="tone === 'light' ? 'text-white' : 'text-ink'"
    >
      TEMPO
    </span>
  </div>
</template>
