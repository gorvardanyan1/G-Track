<script setup lang="ts">
withDefaults(defineProps<{ width?: string; height?: string; rounded?: string }>(), {
  width: '100%',
  height: '1rem',
  rounded: '8px',
});
</script>

<template>
  <span
    class="skeleton block"
    :style="{ width, height, borderRadius: rounded }"
    aria-hidden="true"
  />
</template>
