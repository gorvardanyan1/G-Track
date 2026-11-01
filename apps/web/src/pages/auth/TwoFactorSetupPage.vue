<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import type { TwoFactorSetupResponse } from '@tempo/shared';
import AuthHeading from '../../components/auth/AuthHeading.vue';
import RecoveryCodes from '../../components/auth/RecoveryCodes.vue';
import TotpSecret from '../../components/auth/TotpSecret.vue';
import OtpInput from '../../components/auth/OtpInput.vue';
import AppIcon from '../../components/ui/AppIcon.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import SkeletonBlock from '../../components/ui/SkeletonBlock.vue';
import { homeFor, safeRedirect } from '../../router/guards.ts';
import { useAuthStore } from '../../stores/auth.ts';

/** Super Admins must enrol in 2FA before their first session starts. */
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const setup = ref<TwoFactorSetupResponse | null>(null);
const codes = ref<string[] | null>(null);
const error = ref<string | null>(null);
const busy = ref(false);
const otp = ref<InstanceType<typeof OtpInput> | null>(null);

onMounted(async () => {
  if (!auth.setupToken) return void router.replace('/login');
  try {
    setup.value = await auth.startForcedSetup();
  } catch {
    error.value = 'This setup link has expired. Please sign in again.';
  }
});

async function enable(code: string): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    codes.value = await auth.completeForcedSetup(code);
  } catch {
    error.value = 'That code isn’t right. Check the time on your phone and try again.';
    otp.value?.clear();
  } finally {
    busy.value = false;
  }
}

function finish(): void {
  void router.replace(safeRedirect(route.query['redirect']) ?? homeFor(auth.role ?? 'SUPER_ADMIN'));
}
</script>

<template>
  <div>
    <template v-if="!codes">
      <AuthHeading
        title="Protect your admin account"
        subtitle="Super Admins sign in with a second factor. Add TEMPO to an authenticator app, then enter the code it shows."
      />
      <TotpSecret v-if="setup" :secret="setup.secret" :otpauth-url="setup.otpauthUrl" />
      <div v-else-if="!error" class="flex flex-col gap-3">
        <SkeletonBlock height="5rem" /><SkeletonBlock height="2.5rem" />
      </div>
      <div v-if="setup" class="mt-6">
        <p class="mb-3 text-[13px] font-medium text-ink">Code from the app</p>
        <OtpInput ref="otp" :disabled="busy" :invalid="!!error" @complete="enable" />
      </div>
      <p
        v-if="error"
        class="mt-4 flex items-center gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
        role="alert"
      >
        <AppIcon name="alert" :size="16" /> {{ error }}
      </p>
    </template>
    <template v-else>
      <AuthHeading
        title="Save your recovery codes"
        subtitle="Each one signs you in once if you lose your phone. They won’t be shown again."
      />
      <RecoveryCodes :codes="codes" />
      <BaseButton variant="primary" size="lg" block class="mt-6" @click="finish"
        >I’ve saved them — continue</BaseButton
      >
    </template>
  </div>
</template>
