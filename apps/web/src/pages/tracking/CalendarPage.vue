<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { addDays, startOfLocalDay, toLocalDateTime, type TimeEntryResponse } from '@tempo/shared';
import ManualEntryModal from '../../components/tracking/ManualEntryModal.vue';
import WeekNav from '../../components/tracking/WeekNav.vue';
import AppIcon from '../../components/ui/AppIcon.vue';
import StatusBadge from '../../components/ui/StatusBadge.vue';
import { useWeek } from '../../composables/useWeek.ts';
import {
  dragRange,
  layoutWeek,
  MINUTES_PER_DAY,
  type CalendarBlock,
} from '../../lib/calendar-layout.ts';
import { formatDay, formatDurationHm, timeOf } from '../../lib/time.ts';
import { useClockStore } from '../../stores/clock.ts';
import { useEntriesStore } from '../../stores/entries.ts';
import { useToastStore } from '../../stores/toasts.ts';
import { useUiStore } from '../../stores/ui.ts';

const HOUR = 48;
const week = useWeek();
const clock = useClockStore();
const entries = useEntriesStore();
const toasts = useToastStore();
const ui = useUiStore();
const scroller = ref<HTMLElement | null>(null);

const dates = computed(() => week.sheet.value?.dates ?? []);
const locked = computed(
  () => week.sheet.value?.status === 'SUBMITTED' || week.sheet.value?.status === 'APPROVED',
);

watch(
  () => week.sheet.value?.weekStart,
  async (weekStart) => {
    if (!weekStart) return;
    try {
      await entries.loadRange(weekStart, addDays(weekStart, 6), {
        start: startOfLocalDay(weekStart, week.zone.value),
        end: startOfLocalDay(addDays(weekStart, 7), week.zone.value),
      });
    } catch (e) {
      toasts.error(e, 'Could not load entries');
    }
  },
);

const layout = computed(() =>
  layoutWeek(Object.values(entries.byId), dates.value, week.zone.value, clock.serverNowMs),
);
const dayTotal = (date: string) =>
  (layout.value.get(date) ?? []).reduce((a, b) => a + (b.endMinute - b.startMinute) * 60, 0);

const nowMinute = computed(() => {
  const time = toLocalDateTime(new Date(clock.serverNowMs), week.zone.value).time;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
});

function blockStyle(block: CalendarBlock) {
  const width = 100 / block.lanes;
  return {
    top: `${(block.startMinute / 60) * HOUR}px`,
    height: `${Math.max(18, ((block.endMinute - block.startMinute) / 60) * HOUR - 2)}px`,
    left: `calc(${block.lane * width}% + 3px)`,
    width: `calc(${width}% - 6px)`,
    '--c': block.entry.project.color,
  };
}

// ── drag to create ──
const drag = ref<{ date: string; from: number; to: number } | null>(null);
const dragPreview = computed(() => (drag.value ? dragRange(drag.value.from, drag.value.to) : null));
const minuteAt = (event: PointerEvent, column: HTMLElement) =>
  Math.max(
    0,
    Math.min(MINUTES_PER_DAY, ((event.clientY - column.getBoundingClientRect().top) / HOUR) * 60),
  );

function onDown(event: PointerEvent, date: string): void {
  if (event.button !== 0 || (event.target as HTMLElement).closest('[data-block]')) return;
  const column = event.currentTarget as HTMLElement;
  column.setPointerCapture(event.pointerId);
  const minute = minuteAt(event, column);
  drag.value = { date, from: minute, to: minute };
}
function onMove(event: PointerEvent): void {
  if (drag.value) drag.value.to = minuteAt(event, event.currentTarget as HTMLElement);
}
function onUp(): void {
  if (!drag.value || !dragPreview.value) return;
  const { date } = drag.value;
  const { start, end, endMinute } = dragPreview.value;
  drag.value = null;
  if (locked.value)
    return void toasts.info('This week is locked', 'It was submitted for approval.');
  // A range ending at 24:00 ends on the next day at 00:00, which the dialog shows as "+1 day".
  ui.openManualEntry({ date, start, end: endMinute >= MINUTES_PER_DAY ? '00:00' : end });
}

// ── edit ──
const editing = ref<TimeEntryResponse | null>(null);
const editOpen = ref(false);
function open(block: CalendarBlock): void {
  if (!block.entry.editable || !block.entry.endedAt) return;
  editing.value = block.entry;
  editOpen.value = true;
}

onMounted(async () => {
  await nextTick();
  scroller.value?.scrollTo({ top: 7 * HOUR - 16 });
});
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-center justify-between gap-4">
      <div class="flex items-center gap-3">
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Calendar</h1>
        <StatusBadge v-if="locked" tone="accent"
          ><AppIcon name="lock" :size="12" /> Submitted</StatusBadge
        >
      </div>
      <div class="flex items-center gap-4">
        <p class="hidden text-[13px] text-faint md:block">Drag on the calendar to add time</p>
        <WeekNav
          :week-start="week.sheet.value?.weekStart ?? null"
          :week-end="week.sheet.value?.weekEnd ?? null"
          :is-current="week.isCurrent.value"
          @previous="week.previous"
          @next="week.next"
          @current="week.current"
        />
      </div>
    </div>

    <div class="card overflow-hidden">
      <div class="scrollbar-thin overflow-x-auto">
        <div class="min-w-[820px]">
          <div class="grid grid-cols-[56px_repeat(7,1fr)] border-b border-line">
            <div />
            <div
              v-for="date in dates"
              :key="date"
              class="border-l border-line px-2 py-2.5 text-center"
            >
              <p
                class="text-xs"
                :class="date === week.today.value ? 'font-semibold text-accent-ink' : 'text-faint'"
              >
                {{ formatDay(date, { weekday: 'short' }) }}
              </p>
              <p
                class="num mt-0.5 text-lg font-semibold"
                :class="date === week.today.value ? 'text-accent-ink' : 'text-ink'"
              >
                {{ formatDay(date, { day: 'numeric' }) }}
              </p>
              <p class="num text-[11px] text-faint">
                {{ dayTotal(date) ? formatDurationHm(dayTotal(date)) : '—' }}
              </p>
            </div>
          </div>

          <div
            ref="scroller"
            class="scrollbar-thin relative h-[calc(100dvh-300px)] min-h-[420px] overflow-y-auto"
          >
            <div class="grid grid-cols-[56px_repeat(7,1fr)]" :style="{ height: `${24 * HOUR}px` }">
              <div class="relative">
                <span
                  v-for="h in 23"
                  :key="h"
                  class="num absolute right-2 -translate-y-1/2 text-[10.5px] text-faint"
                  :style="{ top: `${h * HOUR}px` }"
                >
                  {{ String(h).padStart(2, '0') }}:00
                </span>
              </div>
              <div
                v-for="date in dates"
                :key="date"
                class="relative cursor-crosshair touch-none border-l border-line select-none"
                :class="[
                  date === week.today.value && 'bg-accent-soft/30',
                  locked &&
                    'cursor-not-allowed bg-[repeating-linear-gradient(135deg,transparent_0_8px,var(--surface-2)_8px_9px)]',
                ]"
                @pointerdown="onDown($event, date)"
                @pointermove="onMove"
                @pointerup="onUp"
                @pointercancel="drag = null"
              >
                <div
                  v-for="h in 23"
                  :key="h"
                  class="pointer-events-none absolute inset-x-0 border-t border-line/70"
                  :style="{ top: `${h * HOUR}px` }"
                />

                <button
                  v-for="block in layout.get(date) ?? []"
                  :key="`${block.entry.id}-${block.date}`"
                  type="button"
                  data-block
                  class="absolute overflow-hidden rounded-lg border-l-[3px] px-2 py-1 text-left text-xs transition-[box-shadow,transform] hover:z-10 hover:shadow-pop"
                  :class="[
                    block.entry.endedAt === null && 'animate-none ring-2 ring-running/40',
                    block.continuesBefore && 'rounded-t-none',
                    block.continuesAfter && 'rounded-b-none',
                  ]"
                  :style="{
                    ...blockStyle(block),
                    background: 'color-mix(in srgb, var(--c) 16%, var(--surface))',
                    borderColor: 'var(--c)',
                  }"
                  :title="`${block.entry.description || block.entry.project.name} · ${timeOf(block.entry.startedAt, week.zone.value)}–${block.entry.endedAt ? timeOf(block.entry.endedAt, week.zone.value) : 'now'}`"
                  @click="open(block)"
                >
                  <p class="truncate font-medium text-ink">
                    {{ block.entry.description || block.entry.project.name }}
                  </p>
                  <p v-if="block.endMinute - block.startMinute >= 45" class="truncate text-muted">
                    {{ block.entry.project.name
                    }}<template v-if="block.entry.task"> · {{ block.entry.task.name }}</template>
                  </p>
                  <p v-if="block.endMinute - block.startMinute >= 70" class="num text-faint">
                    {{ timeOf(block.entry.startedAt, week.zone.value) }}–{{
                      block.entry.endedAt ? timeOf(block.entry.endedAt, week.zone.value) : 'now'
                    }}
                  </p>
                </button>

                <div
                  v-if="drag && dragPreview && drag.date === date"
                  class="pointer-events-none absolute inset-x-1 z-20 rounded-lg border-2 border-dashed border-accent bg-accent-soft/80 px-2 py-1 text-xs font-medium text-accent-ink"
                  :style="{
                    top: `${(dragPreview.startMinute / 60) * HOUR}px`,
                    height: `${((dragPreview.endMinute - dragPreview.startMinute) / 60) * HOUR}px`,
                  }"
                >
                  <span class="num"
                    >{{ dragPreview.start }}–{{
                      dragPreview.endMinute >= 1440 ? '24:00' : dragPreview.end
                    }}</span
                  >
                </div>

                <div
                  v-if="date === week.today.value"
                  class="pointer-events-none absolute inset-x-0 z-30"
                  :style="{ top: `${(nowMinute / 60) * HOUR}px` }"
                >
                  <div class="relative h-0.5 bg-danger">
                    <span class="absolute -top-[3px] -left-1 size-2 rounded-full bg-danger" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <ManualEntryModal v-model:open="editOpen" :entry="editing" />
  </div>
</template>
