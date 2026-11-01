<script setup lang="ts">
import type { TimesheetResponse } from '@tempo/shared';
import { formatDurationHm } from '../../lib/time.ts';
import ProjectDot from '../ui/ProjectDot.vue';
import StatusBadge from '../ui/StatusBadge.vue';

/** A week's parts: each project's PM approves their own part. */
defineProps<{ reviews: TimesheetResponse['reviews'] }>();

const STATUS = {
  PENDING: { label: 'Waiting', tone: 'accent' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Returned', tone: 'warning' },
} as const;
const name = (r: TimesheetResponse['reviews'][number]) =>
  r.project?.name ?? (r.visible ? 'Whole week' : 'Another project');
</script>

<template>
  <ul class="divide-y divide-line rounded-xl border border-line" aria-label="Approval by project">
    <li v-for="(r, i) in reviews" :key="r.project?.id ?? `part-${i}`" class="px-3.5 py-2.5 text-sm">
      <div class="flex flex-wrap items-center gap-2">
        <ProjectDot v-if="r.project" :color="r.project.color" />
        <span :class="r.visible ? 'text-ink' : 'text-faint'">{{ name(r) }}</span>
        <span v-if="r.seconds > 0" class="num text-xs text-faint">{{
          formatDurationHm(r.seconds)
        }}</span>
        <span v-if="r.canReview" class="text-xs font-medium text-accent-ink"
          >· yours to review</span
        >
        <span class="ml-auto flex items-center gap-2">
          <span v-if="r.reviewer" class="text-xs text-faint">{{ r.reviewer.name }}</span>
          <StatusBadge :tone="STATUS[r.status].tone" dot>{{ STATUS[r.status].label }}</StatusBadge>
        </span>
      </div>
      <p v-if="r.comment" class="mt-1 text-[13px] text-muted">“{{ r.comment }}”</p>
    </li>
  </ul>
</template>
