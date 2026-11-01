<script setup lang="ts" generic="T extends string">
defineProps<{ options: readonly { value: T; label: string }[]; label: string }>();
const model = defineModel<T>({ required: true });
</script>

<template>
  <div role="radiogroup" :aria-label="label" class="inline-flex rounded-[10px] bg-surface-2 p-0.5">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="radio"
      :aria-checked="model === option.value"
      class="h-8 rounded-lg px-3 text-[13px] font-medium transition-all duration-150"
      :class="
        model === option.value ? 'bg-surface text-ink shadow-card' : 'text-muted hover:text-ink'
      "
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>
