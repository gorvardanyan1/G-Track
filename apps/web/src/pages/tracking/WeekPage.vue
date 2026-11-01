<script setup lang="ts">
import { computed, ref } from 'vue';
import { ErrorCode } from '@tempo/shared';
import { ApiError } from '../../api/client.ts';
import { timesheetsApi } from '../../api/timesheets.ts';
import WeekNav from '../../components/tracking/WeekNav.vue';
import AppIcon from '../../components/ui/AppIcon.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import BaseModal from '../../components/ui/BaseModal.vue';
import EmptyState from '../../components/ui/EmptyState.vue';
import ProjectDot from '../../components/ui/ProjectDot.vue';
import SkeletonBlock from '../../components/ui/SkeletonBlock.vue';
import StatusBadge from '../../components/ui/StatusBadge.vue';
import { useWeek } from '../../composables/useWeek.ts';
import { formatDay, formatDurationHm } from '../../lib/time.ts';
import { useToastStore } from '../../stores/toasts.ts';
import { submitState } from '../../lib/timesheet.ts';
import ReviewParts from '../../components/tracking/ReviewParts.vue';

const week = useWeek();
const toasts = useToastStore();
const sheet = week.sheet;

const STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'accent' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Needs changes', tone: 'warning' },
} as const;

const submittable = computed(() =>
  sheet.value ? submitState(sheet.value, week.today.value) : 'locked',
);
const canSubmit = computed(() => submittable.value === 'ready');
/** Parts are worth showing once someone besides the owner is involved. */
const showParts = computed(
  () => sheet.value !== null && sheet.value.status !== 'DRAFT' && sheet.value.reviews.length > 1,
);
const hm = (s: number) => (s > 0 ? formatDurationHm(s) : '');

const confirmOpen = ref(false);
const submitting = ref(false);
async function submit(): Promise<void> {
  if (!sheet.value) return;
  submitting.value = true;
  try {
    sheet.value = await timesheetsApi.submit(sheet.value.weekStart);
    confirmOpen.value = false;
    toasts.success('Timesheet submitted', 'Entries in this week are now read-only.');
  } catch (e) {
    toasts.error(
      e,
      e instanceof ApiError && e.code === ErrorCode.TIMESHEET_APPROVAL_DISABLED
        ? 'Approvals are turned off'
        : 'Could not submit',
    );
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Timesheet</h1>
        <StatusBadge v-if="sheet" :tone="STATUS[sheet.status].tone" dot>{{
          STATUS[sheet.status].label
        }}</StatusBadge>
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <WeekNav
          :week-start="sheet?.weekStart ?? null"
          :week-end="sheet?.weekEnd ?? null"
          :is-current="week.isCurrent.value"
          @previous="week.previous"
          @next="week.next"
          @current="week.current"
        />
        <BaseButton v-if="canSubmit" variant="primary" icon="send" @click="confirmOpen = true"
          >Submit week</BaseButton
        >
        <span
          v-else-if="submittable === 'not-over' && sheet"
          class="text-[13px] text-faint"
          title="Submitting locks the whole week, so it waits until the week is over."
          >Submit after
          {{ formatDay(sheet.weekEnd, { weekday: 'short', day: 'numeric', month: 'short' }) }}</span
        >
      </div>
    </div>

    <Transition name="fade">
      <div
        v-if="sheet?.status === 'REJECTED' && sheet.comment"
        class="mb-5 flex gap-3 rounded-2xl border border-warning/25 bg-warning-soft p-4"
      >
        <AppIcon name="alert" :size="18" class="mt-0.5 text-warning" />
        <div class="text-sm">
          <p class="font-medium text-ink">
            {{ sheet.reviewer?.name ?? 'Your reviewer' }} returned this week
          </p>
          <p class="mt-0.5 text-muted">“{{ sheet.comment }}”</p>
        </div>
      </div>
    </Transition>

    <section v-if="showParts && sheet" class="mb-5">
      <h2 class="mb-2 text-sm font-semibold text-ink">Approval by project</h2>
      <ReviewParts :reviews="sheet.reviews" />
    </section>

    <div class="card overflow-hidden">
      <div v-if="week.loading.value && !sheet" class="space-y-3 p-5">
        <SkeletonBlock v-for="i in 4" :key="i" height="2rem" />
      </div>
      <template v-else-if="sheet">
        <div class="relative">
          <div class="scrollbar-thin overflow-x-auto">
            <table class="w-full min-w-[760px] border-collapse text-sm">
              <thead>
                <tr class="border-b border-line">
                  <th
                    scope="col"
                    class="sticky left-0 z-[1] max-w-[148px] bg-surface sm:max-w-none h-14 px-5 text-left text-xs font-medium text-faint"
                  >
                    Project
                  </th>
                  <th
                    v-for="date in sheet.dates"
                    :key="date"
                    scope="col"
                    class="w-[92px] px-2 text-center text-xs font-medium"
                    :class="date === week.today.value ? 'text-accent-ink' : 'text-faint'"
                  >
                    <span class="block">{{ formatDay(date, { weekday: 'short' }) }}</span>
                    <span
                      class="num mt-0.5 inline-flex size-6 items-center justify-center rounded-full text-[13px]"
                      :class="date === week.today.value ? 'bg-accent text-white' : 'text-muted'"
                    >
                      {{ formatDay(date, { day: 'numeric' }) }}
                    </span>
                  </th>
                  <th scope="col" class="w-[100px] px-5 text-right text-xs font-medium text-faint">
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="row in sheet.projects"
                  :key="row.project.id"
                  class="border-b border-line transition-colors hover:bg-surface-2/50"
                >
                  <th
                    scope="row"
                    class="sticky left-0 z-[1] max-w-[148px] bg-surface sm:max-w-none h-12 px-5 text-left font-medium text-ink"
                  >
                    <span class="flex min-w-0 items-center gap-2.5" :title="row.project.name"
                      ><ProjectDot :color="row.project.color" />
                      <span class="truncate whitespace-nowrap">{{ row.project.name }}</span></span
                    >
                  </th>
                  <td
                    v-for="(seconds, i) in row.seconds"
                    :key="i"
                    class="num px-2 text-center"
                    :class="seconds ? 'text-ink' : 'text-faint/50'"
                  >
                    {{ hm(seconds) || '—' }}
                  </td>
                  <td class="num px-5 text-right font-medium text-ink">
                    {{ formatDurationHm(row.totalSeconds) }}
                  </td>
                </tr>
                <tr v-if="sheet.otherSeconds.some((s) => s > 0)" class="border-b border-line">
                  <th
                    scope="row"
                    class="sticky left-0 z-[1] max-w-[148px] bg-surface sm:max-w-none h-12 px-5 text-left font-normal whitespace-nowrap text-muted"
                  >
                    Other projects
                  </th>
                  <td
                    v-for="(seconds, i) in sheet.otherSeconds"
                    :key="i"
                    class="num px-2 text-center text-muted"
                  >
                    {{ hm(seconds) || '—' }}
                  </td>
                  <td />
                </tr>
              </tbody>
              <tfoot>
                <tr class="bg-surface-2">
                  <th
                    scope="row"
                    class="sticky left-0 z-[1] bg-surface-2 h-12 px-5 text-left text-xs font-semibold tracking-wide text-muted uppercase"
                  >
                    Total
                  </th>
                  <td
                    v-for="(seconds, i) in sheet.dayTotals"
                    :key="i"
                    class="num px-2 text-center font-medium"
                    :class="seconds ? 'text-ink' : 'text-faint/50'"
                  >
                    {{ hm(seconds) || '—' }}
                  </td>
                  <td class="num px-5 text-right text-[15px] font-semibold text-ink">
                    {{ formatDurationHm(sheet.totalSeconds) }}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <!-- Phones: hint that the grid scrolls sideways. -->
          <div
            class="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface to-transparent sm:hidden"
            aria-hidden="true"
          />
        </div>
        <EmptyState
          v-if="sheet.projects.length === 0"
          art="calendar"
          title="No time this week"
          description="Entries you track show up here, split by day in your timezone."
        />
        <p class="border-t border-line px-5 py-3 text-xs text-faint">
          Days follow {{ sheet.timezone }}; time after midnight counts on the next day.
          <template v-if="sheet.submittedAt">
            Submitted
            {{
              new Date(sheet.submittedAt).toLocaleString(undefined, {
                timeZone: sheet.timezone,
                dateStyle: 'medium',
                timeStyle: 'short',
              })
            }}.</template
          >
          <template v-if="sheet.status === 'APPROVED' && sheet.reviewer">
            Approved by {{ sheet.reviewer.name }}.</template
          >
        </p>
      </template>
    </div>

    <BaseModal v-model:open="confirmOpen" title="Submit this week?" size="sm">
      <p class="text-sm text-muted">
        <span class="num font-medium text-ink">{{
          formatDurationHm(sheet?.totalSeconds ?? 0)
        }}</span>
        will go to your project manager for approval. You won’t be able to change entries in this
        week unless it’s returned to you.
      </p>
      <template #footer>
        <BaseButton variant="ghost" @click="confirmOpen = false">Cancel</BaseButton>
        <BaseButton variant="primary" :loading="submitting" @click="submit">Submit</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
