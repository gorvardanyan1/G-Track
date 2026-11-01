<script setup lang="ts">
defineProps<{ label?: string; disabled?: boolean }>();
const model = defineModel<boolean>({ default: false });
</script>

<template>
  <label
    class="inline-flex cursor-pointer items-center gap-2.5 select-none"
    :class="disabled && 'pointer-events-none opacity-50'"
  >
    <button
      type="button"
      role="switch"
      :aria-checked="model"
      :aria-label="label"
      :disabled="disabled"
      class="relative h-5 w-9 shrink-0 rounded-full transition-colors duration-200"
      :class="model ? 'bg-accent' : 'bg-surface-3'"
      @click="model = !model"
    >
      <span
        class="absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow-sm transition-transform duration-200"
        :class="model && 'translate-x-4'"
      />
    </button>
    <span v-if="$slots['default']" class="text-sm text-ink"><slot /></span>
  </label>
</template>
