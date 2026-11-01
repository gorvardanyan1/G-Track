<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { TimesheetResponse } from '@tempo/shared';
import { timesheetsApi } from '../../api/timesheets.ts';
import { formatDay, formatDurationHm } from '../../lib/time.ts';
import { useToastStore } from '../../stores/toasts.ts';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import FormField from '../ui/FormField.vue';
import ProjectDot from '../ui/ProjectDot.vue';
import SkeletonBlock from '../ui/SkeletonBlock.vue';
import StatusBadge from '../ui/StatusBadge.vue';
import UserAvatar from '../ui/UserAvatar.vue';
import { TIMESHEET_STATUS } from './timesheet-status.ts';

const props = defineProps<{ timesheetId: string | null }>();
const emit = defineEmits<{ close: []; reviewed: [sheet: TimesheetResponse] }>();
const toasts = useToastStore();

const sheet = ref<TimesheetResponse | null>(null);
const comment = ref('');
const commentError = ref<string | null>(null);
const busy = ref<'approve' | 'reject' | null>(null);

const open = computed({
  get: () => props.timesheetId !== null,
  set: (value) => !value && emit('close'),
});
watch(
  () => props.timesheetId,
  async (id) => {
    sheet.value = null;
    comment.value = '';
    commentError.value = null;
    if (!id) return;
    try {
      sheet.value = await timesheetsApi.get(id);
    } catch (e) {
      toasts.error(e, 'Could not load the timesheet');
      emit('close');
    }
  },
  { immediate: true },
);

async function review(action: 'approve' | 'reject'): Promise<void> {
  if (!sheet.value?.id) return;
  commentError.value = null;
  if (action === 'reject' && !comment.value.trim()) {
    commentError.value = 'Say what needs to change — the worker sees this comment';
    return;
  }
  busy.value = action;
  try {
    const result =
      action === 'approve'
        ? await timesheetsApi.approve(sheet.value.id, comment.value.trim() || undefined)
        : await timesheetsApi.reject(sheet.value.id, comment.value.trim());
    toasts.success(
      action === 'approve' ? 'Timesheet approved' : 'Timesheet returned',
      `${result.user.name} · week of ${formatDay(result.weekStart, { day: 'numeric', month: 'short' })}`,
    );
    emit('reviewed', result);
  } catch (e) {
    toasts.error(e, action === 'approve' ? 'Could not approve' : 'Could not return it');
  } finally {
    busy.value = null;
  }
}

const hm = (s: number) => (s === 0 ? '' : formatDurationHm(s));
const title = computed(() =>
  sheet.value
    ? `Week of ${formatDay(sheet.value.weekStart, { day: 'numeric', month: 'long' })}`
    : 'Timesheet',
);
</script>

<template>
  <BaseModal v-model:open="open" :title="title" size="lg">
    <div v-if="!sheet" class="space-y-3">
      <SkeletonBlock width="40%" /><SkeletonBlock height="140px" />
    </div>
    <template v-else>
      <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span class="flex items-center gap-3">
          <UserAvatar :name="sheet.user.name" />
          <span>
            <span class="block text-sm font-medium text-ink">{{ sheet.user.name }}</span>
            <span class="block text-xs text-faint">Days in {{ sheet.timezone }}</span>
          </span>
        </span>
        <StatusBadge :tone="TIMESHEET_STATUS[sheet.status].tone" dot>{{
          TIMESHEET_STATUS[sheet.status].label
        }}</StatusBadge>
      </div>

      <div class="scrollbar-thin -mx-6 overflow-x-auto px-6">
        <table class="w-full min-w-[560px] border-collapse text-sm">
          <thead>
            <tr class="border-b border-line text-xs text-faint">
              <th class="h-9 pr-3 text-left font-medium">Project</th>
              <th v-for="d in sheet.dates" :key="d" class="h-9 px-1 text-right font-medium">
                {{ formatDay(d, { weekday: 'short' }) }}
                <span class="block font-normal">{{ formatDay(d, { day: 'numeric' }) }}</span>
              </th>
              <th class="h-9 pl-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in sheet.projects" :key="row.project.id" class="border-b border-line">
              <td class="h-10 pr-3">
                <span class="flex items-center gap-2 text-ink"
                  ><ProjectDot :color="row.project.color" />{{ row.project.name }}</span
                >
              </td>
              <td v-for="(s, i) in row.seconds" :key="i" class="num px-1 text-right text-muted">
                {{ hm(s) }}
              </td>
              <td class="num pl-3 text-right font-medium text-ink">{{ hm(row.totalSeconds) }}</td>
            </tr>
            <tr v-if="sheet.otherSeconds.some((s) => s > 0)" class="border-b border-line">
              <td class="h-10 pr-3 text-faint">Other projects</td>
              <td
                v-for="(s, i) in sheet.otherSeconds"
                :key="i"
                class="num px-1 text-right text-faint"
              >
                {{ hm(s) }}
              </td>
              <td class="num pl-3 text-right text-faint">
                {{ hm(sheet.otherSeconds.reduce((a, b) => a + b, 0)) }}
              </td>
            </tr>
          </tbody>
          <tfoot>
            <tr class="text-ink">
              <td class="h-10 pr-3 font-medium">Total</td>
              <td
                v-for="(s, i) in sheet.dayTotals"
                :key="i"
                class="num px-1 text-right font-medium"
              >
                {{ hm(s) }}
              </td>
              <td class="num pl-3 text-right font-semibold">
                {{ formatDurationHm(sheet.totalSeconds) }}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p
        v-if="sheet.comment && sheet.status !== 'SUBMITTED'"
        class="mt-4 rounded-xl bg-surface-2 p-3 text-sm text-muted"
      >
        <span class="font-medium text-ink">{{ sheet.reviewer?.name ?? 'Reviewer' }}:</span>
        {{ sheet.comment }}
      </p>
      <FormField
        v-if="sheet.canReview"
        label="Comment"
        :error="commentError"
        hint="Optional when approving; required when returning the week."
        for="review-comment"
        class="mt-5"
      >
        <textarea
          id="review-comment"
          v-model="comment"
          rows="3"
          maxlength="1000"
          class="field h-auto resize-y py-2"
          placeholder="E.g. Wednesday looks short — did you forget the client call?"
          :aria-invalid="commentError ? 'true' : undefined"
        />
      </FormField>
    </template>
    <template v-if="sheet?.canReview" #footer>
      <BaseButton variant="ghost" @click="open = false">Close</BaseButton>
      <BaseButton
        variant="danger"
        :loading="busy === 'reject'"
        :disabled="busy !== null"
        @click="review('reject')"
        >Return for changes</BaseButton
      >
      <BaseButton
        variant="primary"
        icon="check"
        :loading="busy === 'approve'"
        :disabled="busy !== null"
        @click="review('approve')"
        >Approve</BaseButton
      >
    </template>
  </BaseModal>
</template>
