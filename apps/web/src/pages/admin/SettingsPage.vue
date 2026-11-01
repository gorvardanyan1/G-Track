<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type { OrgSettingsResponse, RoundingMode } from '@tempo/shared';
import { settingsApi } from '../../api/settings.ts';
import TimezoneSelect from '../../components/auth/TimezoneSelect.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import FormField from '../../components/ui/FormField.vue';
import SearchSelect from '../../components/ui/SearchSelect.vue';
import SegmentedControl from '../../components/ui/SegmentedControl.vue';
import SkeletonBlock from '../../components/ui/SkeletonBlock.vue';
import TextField from '../../components/ui/TextField.vue';
import ToggleSwitch from '../../components/ui/ToggleSwitch.vue';
import {
  changedSettings,
  settingsErrors,
  toSettingsForm,
  type SettingsForm,
} from '../../lib/settings-form.ts';
import { useAuthStore } from '../../stores/auth.ts';
import { useToastStore } from '../../stores/toasts.ts';

const auth = useAuthStore();
const toasts = useToastStore();
const saved = ref<OrgSettingsResponse | null>(null);
const form = ref<SettingsForm | null>(null);
const errors = ref<Partial<Record<keyof SettingsForm, string>>>({});
const saving = ref(false);

onMounted(async () => {
  try {
    saved.value = await settingsApi.get();
    form.value = toSettingsForm(saved.value);
  } catch (e) {
    toasts.error(e, 'Could not load the settings');
  }
});

const changes = computed(() =>
  saved.value && form.value ? changedSettings(saved.value, form.value) : {},
);
const dirty = computed(() => Object.keys(changes.value).length > 0);

async function save(): Promise<void> {
  if (!form.value) return;
  errors.value = settingsErrors(form.value);
  if (Object.keys(errors.value).length || !dirty.value) return;
  saving.value = true;
  try {
    saved.value = await settingsApi.update(changes.value);
    form.value = toSettingsForm(saved.value);
    toasts.success('Settings saved');
  } catch (e) {
    toasts.error(e, 'Could not save the settings');
  } finally {
    saving.value = false;
  }
}
function reset(): void {
  if (saved.value) form.value = toSettingsForm(saved.value);
  errors.value = {};
}

const timeZone = computed({
  get: () => form.value?.defaultTimezone ?? null,
  set: (zone) => form.value && zone && (form.value.defaultTimezone = zone),
});
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const weekdayOptions = WEEKDAYS.map((label, i) => ({ value: String(i + 1), label }));
const roundingOptions = [0, 5, 6, 10, 15, 30, 60].map((m) => ({
  value: String(m),
  label: m === 0 ? 'Off' : `${m} minutes`,
}));
const MODES = [
  { value: 'NEAREST', label: 'Nearest' },
  { value: 'UP', label: 'Up' },
  { value: 'DOWN', label: 'Down' },
] as const satisfies readonly { value: RoundingMode; label: string }[];
const updated = computed(() =>
  saved.value?.updatedAt
    ? `Last changed ${new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: auth.user?.timezone ?? 'UTC',
      }).format(
        new Date(saved.value.updatedAt),
      )}${saved.value.updatedBy ? ` by ${saved.value.updatedBy.name}` : ''}`
    : 'Using the defaults — nothing has been changed yet.',
);
</script>

<template>
  <div class="max-w-3xl">
    <div class="mb-6">
      <h1 class="text-2xl font-semibold tracking-tight text-ink">Organization settings</h1>
      <p class="mt-1 text-sm text-muted">{{ saved ? updated : '' }}</p>
    </div>

    <div v-if="!form" class="card space-y-5 p-6">
      <div v-for="i in 5" :key="i">
        <SkeletonBlock width="25%" /><SkeletonBlock height="38px" class="mt-2" />
      </div>
    </div>
    <form v-else class="space-y-6" @submit.prevent="save">
      <section class="card space-y-5 p-6">
        <h2 class="text-sm font-semibold text-ink">General</h2>
        <TextField
          v-model="form.name"
          label="Organization name"
          maxlength="100"
          :error="errors.name"
        />
        <div class="grid gap-5 sm:grid-cols-2">
          <TimezoneSelect v-model="timeZone" label="Default timezone" />
          <SearchSelect
            :model-value="String(form.weekStartDay)"
            label="Week starts on"
            :options="weekdayOptions"
            @update:model-value="(v) => form && v && (form.weekStartDay = Number(v))"
          />
        </div>
        <p class="text-xs text-faint">
          New people start with the default timezone. Weeks (timesheets, reports, dashboards) begin
          on this day; each person’s days follow their own timezone.
        </p>
      </section>

      <section class="card space-y-5 p-6">
        <div>
          <h2 class="text-sm font-semibold text-ink">Reports</h2>
          <p class="mt-1 text-xs text-faint">
            Rounding applies only when a report or export asks for it. Stored time is never rounded.
          </p>
        </div>
        <div class="grid gap-5 sm:grid-cols-2">
          <SearchSelect
            :model-value="String(form.roundingMinutes)"
            label="Round each entry to"
            :options="roundingOptions"
            @update:model-value="(v) => form && v && (form.roundingMinutes = Number(v))"
          />
          <FormField v-if="form.roundingMinutes > 0" label="Direction">
            <SegmentedControl
              v-model="form.roundingMode"
              label="Rounding direction"
              :options="MODES"
            />
          </FormField>
        </div>
      </section>

      <section class="card space-y-5 p-6">
        <h2 class="text-sm font-semibold text-ink">Time tracking</h2>
        <div class="grid gap-5 sm:grid-cols-2">
          <TextField
            :model-value="String(form.maxTimerHours)"
            label="Stop running timers after (hours)"
            type="number"
            min="0.25"
            max="24"
            step="0.25"
            :error="errors.maxTimerHours"
            hint="Forgotten timers are stopped automatically."
            @update:model-value="(v) => form && (form.maxTimerHours = Number(v))"
          />
        </div>
        <div class="flex flex-wrap items-start justify-between gap-4 border-t border-line pt-5">
          <div>
            <p class="text-sm font-medium text-ink">Timesheet approval</p>
            <p class="text-xs text-faint">
              Workers submit each week; project managers approve or return it.
            </p>
          </div>
          <ToggleSwitch v-model="form.timesheetApprovalEnabled" label="Timesheet approval" />
        </div>
        <div class="flex flex-wrap items-start justify-between gap-4 border-t border-line pt-5">
          <div>
            <p class="text-sm font-medium text-ink">Lock old entries</p>
            <p class="text-xs text-faint">
              Entries older than this can’t be added, changed or deleted.
            </p>
          </div>
          <div class="flex items-center gap-3">
            <div v-if="form.lockEnabled" class="w-28">
              <TextField
                :model-value="String(form.lockAfterDays)"
                type="number"
                min="1"
                max="3650"
                aria-label="Days"
                :error="errors.lockAfterDays"
                @update:model-value="(v) => form && (form.lockAfterDays = Number(v))"
              />
            </div>
            <span v-if="form.lockEnabled" class="text-sm text-muted">days</span>
            <ToggleSwitch v-model="form.lockEnabled" label="Lock old entries" />
          </div>
        </div>
      </section>

      <div
        class="sticky bottom-4 z-10 flex items-center justify-end gap-2 rounded-2xl border p-3 transition-[background-color,border-color,box-shadow] duration-200"
        :class="dirty ? 'border-line bg-surface/95 shadow-pop backdrop-blur' : 'border-transparent'"
      >
        <span v-if="dirty" class="mr-auto flex items-center gap-2 pl-1 text-[13px] text-muted"
          ><span class="size-1.5 rounded-full bg-warning" /> Unsaved changes</span
        >
        <BaseButton variant="ghost" :disabled="!dirty" @click="reset">Discard</BaseButton>
        <BaseButton variant="primary" type="submit" :disabled="!dirty" :loading="saving"
          >Save changes</BaseButton
        >
      </div>
    </form>
  </div>
</template>
