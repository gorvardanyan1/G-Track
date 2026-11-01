<script setup lang="ts">
defineProps<{ title: string; subtitle?: string }>();
</script>

<template>
  <div class="mb-8">
    <h1 class="text-[26px] leading-tight font-semibold tracking-tight text-ink">{{ title }}</h1>
    <p v-if="subtitle" class="mt-2 text-[15px] text-muted">
      <slot name="subtitle">{{ subtitle }}</slot>
    </p>
  </div>
</template>
