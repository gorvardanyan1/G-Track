<script setup lang="ts">
defineProps<{ label?: string; error?: string | null; hint?: string; for?: string }>();
</script>

<template>
  <div class="flex flex-col gap-1.5">
    <label v-if="label" :for="$props.for" class="text-[13px] font-medium text-ink">{{
      label
    }}</label>
    <slot />
    <p v-if="error" class="text-[12.5px] text-danger" role="alert">{{ error }}</p>
    <p v-else-if="hint" class="text-[12.5px] text-faint">{{ hint }}</p>
  </div>
</template>
