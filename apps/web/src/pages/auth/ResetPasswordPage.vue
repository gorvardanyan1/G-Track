<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { checkPasswordPolicy } from '@tempo/shared';
import { authApi } from '../../api/auth.ts';
import { ApiError } from '../../api/client.ts';
import AuthHeading from '../../components/auth/AuthHeading.vue';
import PasswordChecklist from '../../components/auth/PasswordChecklist.vue';
import AppIcon from '../../components/ui/AppIcon.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import TextField from '../../components/ui/TextField.vue';
import { tokenFromHash } from '../../lib/url.ts';

const token = ref<string | null>(null);
const password = ref('');
const confirm = ref('');
const busy = ref(false);
const done = ref(false);
const error = ref<string | null>(null);

onMounted(() => {
  token.value = tokenFromHash(window.location.hash);
  // Keep the token out of the address bar and history.
  history.replaceState(history.state, '', window.location.pathname);
});

const valid = computed(
  () => checkPasswordPolicy(password.value).length === 0 && password.value === confirm.value,
);

async function submit(): Promise<void> {
  if (!token.value) return;
  busy.value = true;
  error.value = null;
  try {
    await authApi.resetPassword(token.value, password.value);
    done.value = true;
  } catch (e) {
    error.value =
      e instanceof ApiError && e.code === 'PASSWORD_POLICY'
        ? e.message
        : 'This reset link is invalid or has expired. Request a new one.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div v-if="done">
      <div
        class="mb-6 flex size-12 items-center justify-center rounded-2xl bg-running-soft text-running"
      >
        <AppIcon name="check" :size="24" />
      </div>
      <AuthHeading
        title="Password changed"
        subtitle="You’ve been signed out everywhere. Sign in with your new password."
      />
      <RouterLink
        to="/login"
        class="inline-flex h-11 w-full items-center justify-center rounded-[10px] bg-accent text-[15px] font-medium text-white hover:bg-accent-hover"
        >Sign in</RouterLink
      >
    </div>
    <div v-else-if="token === null">
      <AuthHeading
        title="Link not valid"
        subtitle="This page needs the link from your email. Request a new one if it expired."
      />
      <RouterLink to="/forgot-password" class="text-sm text-accent-ink hover:underline"
        >Request a new link</RouterLink
      >
    </div>
    <div v-else>
      <AuthHeading
        title="Choose a new password"
        subtitle="Use a long passphrase you don’t use anywhere else."
      />
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <TextField
          v-model="password"
          label="New password"
          type="password"
          autocomplete="new-password"
          required
          autofocus
        />
        <PasswordChecklist :password="password" />
        <TextField
          v-model="confirm"
          label="Repeat password"
          type="password"
          autocomplete="new-password"
          required
          :error="confirm && confirm !== password ? 'Passwords don’t match' : null"
        />
        <p
          v-if="error"
          class="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
          role="alert"
        >
          {{ error }}
        </p>
        <BaseButton
          type="submit"
          variant="primary"
          size="lg"
          block
          :loading="busy"
          :disabled="!valid"
          >Set new password</BaseButton
        >
      </form>
    </div>
  </div>
</template>
