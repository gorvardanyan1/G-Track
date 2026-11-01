<script setup lang="ts">
import { ref } from 'vue';
import { authApi } from '../../api/auth.ts';
import { ApiError } from '../../api/client.ts';
import AuthHeading from '../../components/auth/AuthHeading.vue';
import AppIcon from '../../components/ui/AppIcon.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import TextField from '../../components/ui/TextField.vue';

const email = ref('');
const sent = ref(false);
const busy = ref(false);
const error = ref<string | null>(null);

async function submit(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    await authApi.forgotPassword(email.value);
    sent.value = true;
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 429
        ? 'Too many requests. Please try again later.'
        : 'Please enter a valid email address.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <Transition name="page" mode="out-in">
      <div v-if="!sent" key="form">
        <AuthHeading
          title="Reset your password"
          subtitle="Enter your email and we’ll send you a link to choose a new one."
        />
        <form class="flex flex-col gap-4" @submit.prevent="submit">
          <TextField
            v-model="email"
            label="Email"
            type="email"
            icon="mail"
            autocomplete="email"
            required
            autofocus
            :error="error"
          />
          <BaseButton
            type="submit"
            variant="primary"
            size="lg"
            block
            :loading="busy"
            :disabled="!email"
            >Send reset link</BaseButton
          >
        </form>
      </div>
      <div v-else key="sent">
        <div
          class="mb-6 flex size-12 items-center justify-center rounded-2xl bg-running-soft text-running"
        >
          <AppIcon name="send" :size="22" />
        </div>
        <AuthHeading
          title="Check your inbox"
          subtitle="If an account exists for that address, a reset link is on its way. It works for 30 minutes."
        />
      </div>
    </Transition>
    <RouterLink
      to="/login"
      class="mt-8 inline-flex items-center gap-1.5 text-[13px] text-faint hover:text-ink"
    >
      <AppIcon name="chevron-left" :size="14" /> Back to sign in
    </RouterLink>
  </div>
</template>
