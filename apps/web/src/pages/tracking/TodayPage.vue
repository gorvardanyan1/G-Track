<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import {
  addDays,
  startOfLocalDay,
  toLocalDate,
  todayInZone,
  type TimeEntryResponse,
} from '@tempo/shared';
import EntryRow from '../../components/tracking/EntryRow.vue';
import ManualEntryModal from '../../components/tracking/ManualEntryModal.vue';
import AppIcon from '../../components/ui/AppIcon.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import BaseModal from '../../components/ui/BaseModal.vue';
import EmptyState from '../../components/ui/EmptyState.vue';
import KeyHint from '../../components/ui/KeyHint.vue';
import SkeletonBlock from '../../components/ui/SkeletonBlock.vue';
import { groupByDay } from '../../lib/day-groups.ts';
import { listEnter, listLeave } from '../../lib/motion.ts';
import { formatDay, formatDuration, timeOf } from '../../lib/time.ts';
import { useAuthStore } from '../../stores/auth.ts';
import { useClockStore } from '../../stores/clock.ts';
import { useEntriesStore } from '../../stores/entries.ts';
import { useTimerStore } from '../../stores/timer.ts';
import { useToastStore } from '../../stores/toasts.ts';
import { useUiStore } from '../../stores/ui.ts';

const auth = useAuthStore();
const clock = useClockStore();
const entries = useEntriesStore();
const timer = useTimerStore();
const toasts = useToastStore();
const ui = useUiStore();

const zone = computed(() => auth.user?.timezone ?? 'UTC');
const today = computed(() => todayInZone(zone.value, new Date(clock.serverNowMs)));
const days = ref(14);
const from = computed(() => addDays(today.value, -(days.value - 1)));
const loading = ref(true);
const loadingMore = ref(false);

async function load(): Promise<void> {
  try {
    await entries.loadRange(from.value, today.value, {
      start: startOfLocalDay(from.value, zone.value),
      end: startOfLocalDay(addDays(today.value, 1), zone.value),
    });
  } catch (e) {
    toasts.error(e, 'Could not load your entries');
  } finally {
    loading.value = false;
  }
}
onMounted(load);
// A new day (or a timezone change) shifts the range.
watch([today, zone], () => void load());

const groups = computed(() =>
  groupByDay(Object.values(entries.byId), zone.value, clock.serverNowMs, {
    from: from.value,
    to: today.value,
  }),
);
const weekTotal = computed(() =>
  groups.value
    .filter((g) => g.date > addDays(today.value, -7))
    .reduce((a, g) => a + g.totalSeconds, 0),
);
const todayTotal = computed(
  () => groups.value.find((g) => g.date === today.value)?.totalSeconds ?? 0,
);

function dayLabel(date: string): string {
  if (date === today.value) return 'Today';
  if (date === addDays(today.value, -1)) return 'Yesterday';
  return formatDay(date, { weekday: 'long', day: 'numeric', month: 'short' });
}

async function update(
  entry: TimeEntryResponse,
  patch: Parameters<typeof entries.update>[1],
): Promise<void> {
  try {
    const saved = await entries.update(entry.id, patch);
    if (saved.endedAt === null) timer.applySaved(saved);
  } catch (e) {
    toasts.error(e, 'Could not save the change');
  }
}

async function duplicate(entry: TimeEntryResponse): Promise<void> {
  try {
    await entries.duplicate(entry.id);
    toasts.success('Copied to today');
  } catch (e) {
    toasts.error(e, 'Could not duplicate');
  }
}

async function continueEntry(entry: TimeEntryResponse): Promise<void> {
  try {
    await timer.continueEntry(entry);
  } catch (e) {
    toasts.error(e, 'Could not start the timer');
  }
}

const editing = ref<TimeEntryResponse | null>(null);
const editOpen = ref(false);
function edit(entry: TimeEntryResponse): void {
  editing.value = entry;
  editOpen.value = true;
}

const removing = ref<TimeEntryResponse | null>(null);
const removeOpen = ref(false);
const removingBusy = ref(false);
function askRemove(entry: TimeEntryResponse): void {
  removing.value = entry;
  removeOpen.value = true;
}
async function confirmRemove(): Promise<void> {
  if (!removing.value) return;
  removingBusy.value = true;
  try {
    await entries.remove(removing.value.id);
    timer.applyDeleted(removing.value.id);
    removeOpen.value = false;
    toasts.success('Entry deleted');
  } catch (e) {
    toasts.error(e, 'Could not delete');
  } finally {
    removingBusy.value = false;
  }
}

async function showEarlier(): Promise<void> {
  loadingMore.value = true;
  days.value += 14;
  await load();
  loadingMore.value = false;
}
const dateOf = (iso: string) => toLocalDate(new Date(iso), zone.value);
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Today</h1>
        <p class="mt-1 text-sm text-muted">
          <span class="num text-ink">{{ formatDuration(todayTotal) }}</span> today ·
          <span class="num text-ink">{{ formatDuration(weekTotal) }}</span> in the last 7 days
        </p>
      </div>
      <BaseButton icon="plus" @click="ui.openManualEntry()">
        Add entry <KeyHint class="ml-1">N</KeyHint>
      </BaseButton>
    </div>

    <div v-if="loading" class="card divide-y divide-line">
      <div v-for="i in 5" :key="i" class="flex items-center gap-4 px-5 py-4">
        <SkeletonBlock width="40%" />
        <SkeletonBlock width="18%" />
        <SkeletonBlock width="12%" class="ml-auto" />
      </div>
    </div>

    <div v-else-if="groups.length === 0" class="card">
      <EmptyState
        title="Nothing tracked yet"
        description="Start the timer up top, or add time you’ve already worked."
      >
        <BaseButton variant="primary" icon="plus" @click="ui.openManualEntry()"
          >Add your first entry</BaseButton
        >
      </EmptyState>
    </div>

    <div v-else class="flex flex-col gap-5">
      <section v-for="group in groups" :key="group.date" class="card overflow-hidden">
        <header
          class="flex items-center justify-between border-b border-line bg-surface-2/40 px-5 py-3"
        >
          <h2 class="text-sm font-semibold text-ink">
            {{ dayLabel(group.date) }}
            <span
              v-if="group.date === today || group.date === addDays(today, -1)"
              class="ml-1.5 font-normal text-faint"
              >{{ formatDay(group.date) }}</span
            >
          </h2>
          <span class="num text-sm font-medium text-ink">{{
            formatDuration(group.totalSeconds)
          }}</span>
        </header>
        <TransitionGroup
          tag="div"
          class="divide-y divide-line"
          :css="false"
          @enter="listEnter"
          @leave="listLeave"
        >
          <EntryRow
            v-for="(entry, index) in group.entries"
            :key="entry.id"
            :data-index="index"
            :entry="entry"
            :zone="zone"
            @update="update(entry, $event)"
            @edit="edit(entry)"
            @continue="continueEntry(entry)"
            @duplicate="duplicate(entry)"
            @remove="askRemove(entry)"
          />
        </TransitionGroup>
        <!-- Entries that started the day before: shown, not editable here (edit them on their day). -->
        <div
          v-for="carried in group.carriedOver"
          :key="`carried:${carried.entry.id}`"
          class="flex items-center gap-3 border-t border-line py-2.5 pr-5 pl-[18px] text-[13px] first:border-t-0"
          :style="{ boxShadow: `inset 3px 0 0 ${carried.entry.project.color}55` }"
        >
          <AppIcon name="chevron-right" :size="14" class="shrink-0 text-faint" />
          <span class="min-w-0 flex-1 truncate text-muted">
            <span class="text-ink">{{ carried.entry.description || 'No description' }}</span>
            · {{ carried.entry.project.name }} · continued from
            {{ formatDay(dateOf(carried.entry.startedAt), { weekday: 'short' }) }}
            {{ timeOf(carried.entry.startedAt, zone) }}
          </span>
          <span class="num shrink-0 text-muted">{{ formatDuration(carried.seconds) }}</span>
        </div>
      </section>
      <div class="flex justify-center">
        <BaseButton variant="ghost" icon="refresh" :loading="loadingMore" @click="showEarlier"
          >Show earlier days</BaseButton
        >
      </div>
    </div>

    <ManualEntryModal v-model:open="editOpen" :entry="editing" />
    <BaseModal
      v-model:open="removeOpen"
      title="Delete this entry?"
      size="sm"
      description="This can’t be undone."
    >
      <p v-if="removing" class="text-sm text-muted">
        <span class="text-ink">{{ removing.description || 'No description' }}</span> ·
        {{ removing.project.name }} ·
        <span class="num">{{ formatDuration(removing.durationSeconds ?? 0) }}</span>
      </p>
      <template #footer>
        <BaseButton variant="ghost" @click="removeOpen = false">Cancel</BaseButton>
        <BaseButton variant="danger" :loading="removingBusy" @click="confirmRemove"
          >Delete</BaseButton
        >
      </template>
    </BaseModal>
  </div>
</template>
