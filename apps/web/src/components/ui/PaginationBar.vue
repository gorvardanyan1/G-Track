<script setup lang="ts">
import { computed } from 'vue';
import IconButton from './IconButton.vue';

const props = defineProps<{ total: number; pageSize: number; noun?: string }>();
const page = defineModel<number>({ required: true });
const pages = computed(() => Math.max(1, Math.ceil(props.total / props.pageSize)));
const first = computed(() => (props.total === 0 ? 0 : (page.value - 1) * props.pageSize + 1));
const last = computed(() => Math.min(props.total, page.value * props.pageSize));
</script>

<template>
  <div
    class="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-[13px] text-muted"
  >
    <span class="num"
      >{{ first }}–{{ last }} of {{ total }} {{ noun ?? (total === 1 ? 'item' : 'items') }}</span
    >
    <div class="flex items-center gap-1">
      <IconButton
        icon="chevron-left"
        label="Previous page"
        size="sm"
        :disabled="page <= 1"
        @click="page = page - 1"
      />
      <span class="num min-w-14 text-center">{{ page }} / {{ pages }}</span>
      <IconButton
        icon="chevron-right"
        label="Next page"
        size="sm"
        :disabled="page >= pages"
        @click="page = page + 1"
      />
    </div>
  </div>
</template>
