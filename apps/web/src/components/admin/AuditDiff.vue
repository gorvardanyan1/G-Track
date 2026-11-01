<script setup lang="ts">
import { computed } from 'vue';
import { auditDiff, formatAuditValue } from '../../lib/audit-diff.ts';

const props = defineProps<{ before: unknown; after: unknown }>();
const rows = computed(() => auditDiff(props.before, props.after));
const MARK = { changed: '~', added: '+', removed: '−', same: '' } as const;
</script>

<template>
  <p v-if="rows.length === 0" class="rounded-xl bg-surface-2 p-4 text-sm text-faint">
    This event recorded no data snapshot.
  </p>
  <div v-else class="overflow-hidden rounded-xl border border-line">
    <table class="w-full border-collapse text-[13px]">
      <thead>
        <tr class="border-b border-line bg-surface-2/60 text-xs text-faint">
          <th class="h-8 w-8" />
          <th class="h-8 px-3 text-left font-medium">Field</th>
          <th class="h-8 px-3 text-left font-medium">Before</th>
          <th class="h-8 px-3 text-left font-medium">After</th>
        </tr>
      </thead>
      <tbody class="font-mono">
        <tr
          v-for="row in rows"
          :key="row.path"
          class="border-b border-line last:border-0"
          :class="{
            'bg-warning-soft/60': row.kind === 'changed',
            'bg-running-soft/70': row.kind === 'added',
            'bg-danger-soft/70': row.kind === 'removed',
          }"
        >
          <td
            class="text-center font-semibold"
            :class="{
              'text-warning': row.kind === 'changed',
              'text-running': row.kind === 'added',
              'text-danger': row.kind === 'removed',
            }"
          >
            {{ MARK[row.kind] }}
          </td>
          <td class="px-3 py-2 align-top whitespace-nowrap text-ink">{{ row.path }}</td>
          <td
            class="px-3 py-2 align-top break-all"
            :class="row.kind === 'same' ? 'text-faint' : 'text-muted'"
            :style="
              row.kind === 'changed' || row.kind === 'removed'
                ? 'text-decoration: line-through; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent)'
                : undefined
            "
          >
            {{ row.kind === 'added' ? '' : formatAuditValue(row.before) }}
          </td>
          <td
            class="px-3 py-2 align-top break-all"
            :class="row.kind === 'same' ? 'text-faint' : 'text-ink'"
          >
            {{ row.kind === 'removed' ? '' : formatAuditValue(row.after) }}
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
