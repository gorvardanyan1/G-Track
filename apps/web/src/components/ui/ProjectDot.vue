<script setup lang="ts">
withDefaults(defineProps<{ color: string; size?: number }>(), { size: 8 });
</script>

<template>
  <span
    class="inline-block shrink-0 rounded-full"
    :style="{
      width: `${size}px`,
      height: `${size}px`,
      background: color,
      boxShadow: `0 0 0 3px ${color}22`,
    }"
    aria-hidden="true"
  />
</template>
