<script setup lang="ts">
import { computed } from 'vue';
import { deviceTimeZone, timeZones, utcOffsetLabel } from '../../lib/time.ts';
import SearchSelect, { type SelectOption } from '../ui/SearchSelect.vue';

defineProps<{ label?: string; error?: string | null }>();
const model = defineModel<string | null>({ default: null });

const device = deviceTimeZone();
const options = computed<SelectOption[]>(() => {
  const now = new Date();
  const zones = timeZones();
  const ordered = [device, ...zones.filter((z) => z !== device)];
  return ordered.map((zone) => ({
    value: zone,
    label: zone.replaceAll('_', ' '),
    hint: utcOffsetLabel(zone, now),
    group: zone === device ? 'This device' : 'All timezones',
    keywords: `${zone} ${utcOffsetLabel(zone, now)}`,
  }));
});
</script>

<template>
  <SearchSelect
    v-model="model"
    :options="options"
    :label="label"
    :error="error"
    placeholder="Choose a timezone"
    search-placeholder="Search city or UTC offset…"
  />
</template>
