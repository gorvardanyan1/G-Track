<script setup lang="ts">
import { computed } from 'vue';
import { formatDay } from '../../lib/time.ts';
import BaseButton from '../ui/BaseButton.vue';
import IconButton from '../ui/IconButton.vue';

/** "‹ 26 Oct – 1 Nov 2026 › This week" navigation by local dates. */
const props = defineProps<{
  weekStart: string | null;
  weekEnd: string | null;
  isCurrent: boolean;
}>();
defineEmits<{ previous: []; next: []; current: [] }>();
const label = computed(() =>
  props.weekStart && props.weekEnd
    ? `${formatDay(props.weekStart, { day: 'numeric', month: 'short' })} – ${formatDay(props.weekEnd, { day: 'numeric', month: 'short', year: 'numeric' })}`
    : '…',
);
</script>

<template>
  <div class="flex items-center gap-1">
    <IconButton icon="chevron-left" label="Previous week" @click="$emit('previous')" />
    <span class="num min-w-[170px] text-center text-sm font-medium text-ink">{{ label }}</span>
    <IconButton icon="chevron-right" label="Next week" @click="$emit('next')" />
    <BaseButton v-if="!isCurrent" size="sm" variant="ghost" class="ml-1" @click="$emit('current')"
      >This week</BaseButton
    >
  </div>
</template>
