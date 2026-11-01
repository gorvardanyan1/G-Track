<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '../../api/client.ts';
import AuthHeading from '../../components/auth/AuthHeading.vue';
import OtpInput from '../../components/auth/OtpInput.vue';
import AppIcon from '../../components/ui/AppIcon.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import TextField from '../../components/ui/TextField.vue';
import { homeFor, safeRedirect } from '../../router/guards.ts';
import { useAuthStore } from '../../stores/auth.ts';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const otp = ref<InstanceType<typeof OtpInput> | null>(null);
const useRecovery = ref(false);
const recoveryCode = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

onMounted(() => {
  if (!auth.challengeToken) void router.replace('/login');
});

async function verify(input: { code: string } | { recoveryCode: string }): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    await auth.verifyTwoFactor(input);
    await router.replace(safeRedirect(route.query['redirect']) ?? homeFor(auth.role ?? 'WORKER'));
  } catch (e) {
    if (e instanceof ApiError && e.code === 'INVALID_TOKEN') {
      auth.challengeToken = null;
      error.value = 'This sign-in took too long. Please start again.';
      setTimeout(() => void router.replace('/login'), 1800);
    } else {
      error.value =
        e instanceof ApiError && e.status === 429
          ? 'Too many attempts. Please wait a few minutes.'
          : useRecovery.value
            ? 'That recovery code isn’t valid (each works only once).'
            : 'That code isn’t right. Codes change every 30 seconds.';
      otp.value?.clear();
    }
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div
      class="mb-6 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent-ink"
    >
      <AppIcon name="shield" :size="24" />
    </div>
    <AuthHeading
      title="Two-factor authentication"
      :subtitle="
        useRecovery
          ? 'Enter one of the recovery codes you saved.'
          : 'Enter the 6-digit code from your authenticator app.'
      "
    />
    <div v-if="!useRecovery">
      <OtpInput
        ref="otp"
        :disabled="busy"
        :invalid="!!error"
        @complete="verify({ code: $event })"
      />
    </div>
    <form v-else class="flex flex-col gap-4" @submit.prevent="verify({ recoveryCode })">
      <TextField
        v-model="recoveryCode"
        label="Recovery code"
        class="num"
        placeholder="xxxxx-xxxxx"
        autocomplete="off"
        autofocus
      />
      <BaseButton
        type="submit"
        variant="primary"
        size="lg"
        block
        :loading="busy"
        :disabled="recoveryCode.length < 8"
        >Verify</BaseButton
      >
    </form>
    <Transition name="fade">
      <p
        v-if="error"
        class="mt-4 flex items-center gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
        role="alert"
      >
        <AppIcon name="alert" :size="16" /> {{ error }}
      </p>
    </Transition>
    <div class="mt-8 flex items-center justify-between text-[13px]">
      <button
        type="button"
        class="text-accent-ink hover:underline"
        @click="
          useRecovery = !useRecovery;
          error = null;
        "
      >
        {{ useRecovery ? 'Use the authenticator app' : 'Use a recovery code' }}
      </button>
      <RouterLink to="/login" class="text-faint hover:text-ink">Back to sign in</RouterLink>
    </div>
  </div>
</template>
