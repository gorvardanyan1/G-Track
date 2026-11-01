<script setup lang="ts" generic="Row">
export interface Column {
  key: string;
  label: string;
  align?: 'left' | 'right';
  class?: string;
}

defineProps<{
  columns: readonly Column[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  loading?: boolean;
}>();
</script>

<template>
  <div class="scrollbar-thin overflow-x-auto">
    <table class="w-full border-collapse text-sm">
      <!-- Column headers over an empty state read as a broken table: hide them then. -->
      <thead v-if="loading || rows.length > 0 || !$slots['empty']">
        <tr class="border-b border-line">
          <th
            v-for="column in columns"
            :key="column.key"
            scope="col"
            class="h-10 px-4 text-xs font-medium whitespace-nowrap text-faint first:pl-5 last:pr-5"
            :class="[column.align === 'right' ? 'text-right' : 'text-left', column.class]"
          >
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <template v-if="loading">
          <tr v-for="i in 4" :key="i" class="border-b border-line last:border-0">
            <td v-for="column in columns" :key="column.key" class="h-12 px-4 first:pl-5 last:pr-5">
              <span
                class="skeleton block h-3.5 rounded"
                :style="{ width: `${40 + ((i * 17) % 45)}%` }"
              />
            </td>
          </tr>
        </template>
        <tr
          v-for="row in rows"
          v-else
          :key="rowKey(row)"
          class="border-b border-line transition-colors last:border-0 hover:bg-surface-2/60"
        >
          <td
            v-for="column in columns"
            :key="column.key"
            class="h-12 px-4 first:pl-5 last:pr-5"
            :class="[column.align === 'right' && 'text-right', column.class]"
          >
            <slot :name="column.key" :row="row" />
          </td>
        </tr>
      </tbody>
    </table>
    <slot v-if="!loading && rows.length === 0" name="empty" />
  </div>
</template>
