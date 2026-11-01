<script setup lang="ts">
import { useId } from 'vue';
import AppIcon from './AppIcon.vue';
import FormField from './FormField.vue';
import type { IconName } from './icons.ts';

defineOptions({ inheritAttrs: false });
defineProps<{ label?: string; error?: string | null; hint?: string; icon?: IconName }>();
const model = defineModel<string | number>({ default: '' });
const id = useId();
</script>

<template>
  <FormField :label="label" :error="error" :hint="hint" :for="id">
    <div class="relative">
      <AppIcon
        v-if="icon"
        :name="icon"
        :size="16"
        class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
      />
      <input
        :id="id"
        v-model="model"
        v-bind="$attrs"
        class="field"
        :class="icon && 'pl-9'"
        :aria-invalid="error ? 'true' : undefined"
      />
    </div>
  </FormField>
</template>
