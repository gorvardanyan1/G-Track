<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from 'vue';
import {
  addDays,
  localDateTimeToUtc,
  todayInZone,
  toLocalDateTime,
  type TimeEntryResponse,
} from '@tempo/shared';
import { describeEntryError, type EntryErrors, type EntryField } from '../../lib/entry-errors.ts';
import { formatDuration } from '../../lib/time.ts';
import { useAuthStore } from '../../stores/auth.ts';
import { useClockStore } from '../../stores/clock.ts';
import { useEntriesStore } from '../../stores/entries.ts';
import { useProjectsStore } from '../../stores/projects.ts';
import { useTimerStore } from '../../stores/timer.ts';
import { useToastStore } from '../../stores/toasts.ts';
import type { ManualEntryPrefill } from '../../stores/ui.ts';
import AppIcon from '../ui/AppIcon.vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import FormField from '../ui/FormField.vue';
import StatusBadge from '../ui/StatusBadge.vue';
import ToggleSwitch from '../ui/ToggleSwitch.vue';
import ProjectTaskPicker from './ProjectTaskPicker.vue';

const ids = { description: useId(), date: useId(), start: useId(), end: useId() };

/** Create (or edit) an entry by local date and times in the profile timezone. */
const props = defineProps<{ prefill?: ManualEntryPrefill; entry?: TimeEntryResponse | null }>();
const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ saved: [TimeEntryResponse] }>();

const auth = useAuthStore();
const clock = useClockStore();
const entries = useEntriesStore();
const projects = useProjectsStore();
const timer = useTimerStore();
const toasts = useToastStore();

const zone = computed(() => auth.user?.timezone ?? 'UTC');
const form = reactive({
  date: '',
  start: '',
  end: '',
  projectId: null as string | null,
  taskId: null as string | null,
  description: '',
  isBillable: true,
  ambiguity: { start: undefined, end: undefined } as Record<
    EntryField,
    'earlier' | 'later' | undefined
  >,
});
const errors = ref<EntryErrors>({ ambiguous: [] });
const projectError = ref<string | null>(null);
const saving = ref(false);

const pad = (n: number) => String(n).padStart(2, '0');
const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
/** An end at or before the start means the next day (e.g. 22:00 → 02:00). */
const endsNextDay = computed(
  () => form.start !== '' && form.end !== '' && minutesOf(form.end) <= minutesOf(form.start),
);
const endDate = computed(() =>
  form.date && endsNextDay.value ? addDays(form.date, 1) : form.date,
);
/** Real duration (DST-aware) of what's entered; null while it isn't a valid range yet. */
const previewSeconds = computed(() => {
  if (!form.date || !form.start || !form.end) return null;
  const start = localDateTimeToUtc(form.date, form.start, zone.value, {
    ambiguous: form.ambiguity.start ?? 'earlier',
  });
  const end = localDateTimeToUtc(endDate.value, form.end, zone.value, {
    ambiguous: form.ambiguity.end ?? 'later',
  });
  if (!start.ok || !end.ok) return null;
  const seconds = (end.utc.getTime() - start.utc.getTime()) / 1000;
  return seconds > 0 ? seconds : null;
});

function reset(): void {
  errors.value = { ambiguous: [] };
  projectError.value = null;
  form.ambiguity = { start: undefined, end: undefined };
  const entry = props.entry;
  if (entry?.endedAt) {
    const start = toLocalDateTime(new Date(entry.startedAt), zone.value);
    const end = toLocalDateTime(new Date(entry.endedAt), zone.value);
    Object.assign(form, {
      date: start.date,
      start: start.time.slice(0, 5),
      end: end.time.slice(0, 5),
      projectId: entry.projectId,
      taskId: entry.taskId,
      description: entry.description,
      isBillable: entry.isBillable,
    });
    return;
  }
  // New: the hour before now (rounded to 5 min), unless the caller says otherwise.
  const now = new Date(clock.serverNowMs);
  const local = toLocalDateTime(now, zone.value);
  const endMinutes = Math.floor(minutesOf(local.time) / 5) * 5;
  const startMinutes = Math.max(0, endMinutes - 60);
  const draftProject = timer.draft.projectId ?? projects.trackable[0]?.id ?? null;
  Object.assign(form, {
    date: props.prefill?.date ?? todayInZone(zone.value, now),
    start:
      props.prefill?.start ?? `${pad(Math.floor(startMinutes / 60))}:${pad(startMinutes % 60)}`,
    end: props.prefill?.end ?? `${pad(Math.floor(endMinutes / 60))}:${pad(endMinutes % 60)}`,
    projectId: draftProject,
    taskId: draftProject === timer.draft.projectId ? timer.draft.taskId : null,
    description: '',
    isBillable: projects.byId(draftProject)?.isBillable ?? true,
  });
}

watch(open, (isOpen) => isOpen && reset(), { immediate: true });
watch(
  () => form.projectId,
  (id, previous) => {
    if (previous !== undefined && id !== previous && !props.entry)
      form.isBillable = projects.byId(id)?.isBillable ?? true;
  },
);
// Changing a time invalidates a previous "which one did you mean" answer.
watch(
  () => [form.date, form.start],
  () => (form.ambiguity.start = undefined),
);
watch(
  () => [form.date, form.end],
  () => (form.ambiguity.end = undefined),
);

/** "02:30 CEST (UTC+02:00)" for an ambiguous choice. */
function describeInstant(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone.value,
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(iso));
  const offset = new Intl.DateTimeFormat('en-US', {
    timeZone: zone.value,
    timeZoneName: 'longOffset',
  })
    .formatToParts(new Date(iso))
    .find((p) => p.type === 'timeZoneName')
    ?.value.replace('GMT', 'UTC');
  return `${parts} (${offset ?? 'UTC'})`;
}

async function submit(): Promise<void> {
  projectError.value = form.projectId ? null : 'Choose a project';
  if (!form.projectId || !form.date || !form.start || !form.end) return;
  saving.value = true;
  errors.value = { ambiguous: [] };
  const body = {
    projectId: form.projectId,
    taskId: form.taskId,
    description: form.description.trim(),
    isBillable: form.isBillable,
    start: {
      date: form.date,
      time: form.start,
      ...(form.ambiguity.start && { ambiguity: form.ambiguity.start }),
    },
    end: {
      date: endDate.value,
      time: form.end,
      ...(form.ambiguity.end && { ambiguity: form.ambiguity.end }),
    },
  };
  try {
    const saved = props.entry
      ? await entries.update(props.entry.id, body)
      : await entries.create(body);
    toasts.success(
      props.entry ? 'Entry updated' : 'Entry added',
      `${form.start}–${form.end} · ${formatDuration(saved.durationSeconds ?? 0)}`,
    );
    emit('saved', saved);
    open.value = false;
  } catch (error) {
    errors.value = describeEntryError(error);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <BaseModal
    v-model:open="open"
    :title="entry ? 'Edit time entry' : 'New time entry'"
    :description="`Times are in ${zone}.`"
  >
    <form id="manual-entry" class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <ProjectTaskPicker
        v-model:project-id="form.projectId"
        v-model:task-id="form.taskId"
        label="Project"
        :error="projectError"
      />
      <FormField label="Description" :for="ids.description">
        <input
          :id="ids.description"
          v-model="form.description"
          class="field"
          placeholder="What did you work on?"
          maxlength="500"
        />
      </FormField>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-[1.3fr_1fr_1fr]">
        <FormField label="Date" :for="ids.date" class="col-span-2 sm:col-span-1">
          <input :id="ids.date" v-model="form.date" type="date" class="field num" required />
        </FormField>
        <FormField label="Start" :error="errors.start" :for="ids.start">
          <input
            :id="ids.start"
            v-model="form.start"
            type="time"
            class="field num"
            :aria-invalid="errors.start ? 'true' : undefined"
            required
          />
        </FormField>
        <FormField :error="errors.end">
          <template #default>
            <label
              :for="ids.end"
              class="flex items-center justify-between text-[13px] font-medium text-ink"
            >
              End
              <StatusBadge v-if="endsNextDay" tone="accent" class="!h-5 !px-2 !text-[11px]"
                >+1 day</StatusBadge
              >
            </label>
            <input
              :id="ids.end"
              v-model="form.end"
              type="time"
              class="field num"
              :aria-invalid="errors.end ? 'true' : undefined"
              required
            />
          </template>
        </FormField>
      </div>

      <div
        v-for="choice in errors.ambiguous"
        :key="choice.field"
        class="rounded-xl border border-warning/30 bg-warning-soft p-3.5"
        role="group"
        :aria-label="`Which ${choice.field} time?`"
      >
        <p class="text-sm font-medium text-ink">
          {{ choice.field === 'start' ? form.start : form.end }} happens twice on
          {{ choice.field === 'start' ? form.date : endDate }} — clocks go back that night.
        </p>
        <div class="mt-2.5 grid grid-cols-2 gap-2">
          <button
            v-for="option in ['earlier', 'later'] as const"
            :key="option"
            type="button"
            class="rounded-lg border px-3 py-2 text-left text-sm transition-colors"
            :class="
              form.ambiguity[choice.field] === option
                ? 'border-accent bg-accent-soft text-accent-ink'
                : 'border-line bg-surface text-ink hover:border-line-strong'
            "
            @click="
              form.ambiguity[choice.field] = option;
              submit();
            "
          >
            <span class="block text-xs text-muted">{{
              option === 'earlier'
                ? 'The first time (before clocks go back)'
                : 'The second time (after clocks go back)'
            }}</span>
            <span class="num">{{
              describeInstant(option === 'earlier' ? choice.earlier : choice.later)
            }}</span>
          </button>
        </div>
      </div>

      <div class="flex items-center justify-between">
        <ToggleSwitch v-model="form.isBillable">Billable</ToggleSwitch>
        <span v-if="previewSeconds !== null" class="num text-sm text-muted">{{
          formatDuration(previewSeconds)
        }}</span>
      </div>

      <div
        v-if="errors.form"
        class="flex items-start gap-2.5 rounded-xl bg-danger-soft p-3 text-sm text-danger"
        role="alert"
      >
        <AppIcon name="alert" :size="17" class="mt-px" />
        <span>{{ errors.form }}</span>
      </div>
    </form>
    <template #footer>
      <BaseButton variant="ghost" @click="open = false">Cancel</BaseButton>
      <BaseButton variant="primary" type="submit" form="manual-entry" :loading="saving">
        {{ entry ? 'Save changes' : 'Add entry' }}
      </BaseButton>
    </template>
  </BaseModal>
</template>
