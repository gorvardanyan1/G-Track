<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { countUp } from '../../lib/motion.ts';
import AppIcon from '../ui/AppIcon.vue';
import type { IconName } from '../ui/icons.ts';

/** A summary figure that counts up when it changes. */
const props = defineProps<{
  label: string;
  value: number;
  format: (value: number) => string;
  icon: IconName;
  hint?: string;
}>();
const el = ref<HTMLElement | null>(null);
let shown = 0;

function animate(): void {
  if (!el.value) return;
  countUp(el.value, shown, props.value, props.format);
  shown = props.value;
}
onMounted(animate);
watch(() => props.value, animate);
</script>

<template>
  <div class="card p-5">
    <div class="flex items-center justify-between text-[13px] text-muted">
      {{ label }}
      <span class="flex size-7 items-center justify-center rounded-lg bg-surface-2 text-faint"
        ><AppIcon :name="icon" :size="15"
      /></span>
    </div>
    <p ref="el" class="num mt-2 text-[26px] font-semibold tracking-tight text-ink">
      {{ format(0) }}
    </p>
    <p v-if="hint" class="mt-0.5 text-xs text-faint">{{ hint }}</p>
  </div>
</template>
