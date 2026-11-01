<script setup lang="ts">
import { computed, ref } from 'vue';
import { deviceTimeZone, utcOffsetLabel } from '../../lib/time.ts';
import { readStorage, writeStorage } from '../../lib/storage.ts';
import { useAuthStore } from '../../stores/auth.ts';
import { useToastStore } from '../../stores/toasts.ts';
import AppIcon from '../ui/AppIcon.vue';
import BaseButton from '../ui/BaseButton.vue';

/**
 * Shown when this device is in a different timezone than the profile. All times follow the
 * profile; the user can switch it or keep it (remembered for this pair of zones).
 */
const auth = useAuthStore();
const toasts = useToastStore();
const device = deviceTimeZone();
const saving = ref(false);
const dismissedKey = computed(() => `tempo.tz-ok.${auth.user?.timezone}.${device}`);
const dismissed = ref(false);

const visible = computed(
  () =>
    auth.user !== null &&
    auth.user.timezone !== device &&
    !dismissed.value &&
    readStorage(dismissedKey.value) === null &&
    // Same offset right now (e.g. Europe/Berlin vs Europe/Paris): nothing to explain.
    utcOffsetLabel(auth.user.timezone) !== utcOffsetLabel(device),
);

async function switchZone(): Promise<void> {
  saving.value = true;
  try {
    await auth.updateProfile({ timezone: device });
    toasts.success('Timezone updated', `Times now show in ${device}.`);
  } catch (error) {
    toasts.error(error, 'Could not change your timezone');
  } finally {
    saving.value = false;
  }
}

function keep(): void {
  writeStorage(dismissedKey.value, '1');
  dismissed.value = true;
}
</script>

<template>
  <Transition name="fade">
    <div v-if="visible" class="border-b border-warning/20 bg-warning-soft">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 text-sm lg:px-8">
        <AppIcon name="globe" :size="17" class="text-warning" />
        <p class="min-w-0 flex-1 basis-64 text-ink">
          This device is in <strong class="font-semibold">{{ device }}</strong>
          <span class="text-muted">&nbsp;({{ utcOffsetLabel(device) }})</span>, but your profile
          uses
          <strong class="font-semibold">{{ auth.user?.timezone }}</strong>
          <span class="text-muted">&nbsp;({{ utcOffsetLabel(auth.user?.timezone ?? 'UTC') }})</span
          >. Days and times follow your profile.
        </p>
        <div class="flex gap-2">
          <BaseButton size="sm" variant="ghost" @click="keep"
            >Keep {{ auth.user?.timezone }}</BaseButton
          >
          <BaseButton size="sm" variant="secondary" :loading="saving" @click="switchZone"
            >Use {{ device }}</BaseButton
          >
        </div>
      </div>
    </div>
  </Transition>
</template>
