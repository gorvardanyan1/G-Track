<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { ApiError } from '../../api/client.ts';
import AuthHeading from '../../components/auth/AuthHeading.vue';
import AppIcon from '../../components/ui/AppIcon.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import TextField from '../../components/ui/TextField.vue';
import { homeFor, safeRedirect } from '../../router/guards.ts';
import { useAuthStore } from '../../stores/auth.ts';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const email = ref('');
const password = ref('');
const error = ref<string | null>(null);
const busy = ref(false);

async function submit(): Promise<void> {
  error.value = null;
  busy.value = true;
  try {
    const step = await auth.login(email.value, password.value);
    const query = route.query['redirect']
      ? { redirect: String(route.query['redirect']) }
      : undefined;
    if (step === 'two_factor') return void (await router.push({ path: '/login/2fa', query }));
    if (step === 'two_factor_setup')
      return void (await router.push({ path: '/login/2fa-setup', query }));
    await router.replace(safeRedirect(route.query['redirect']) ?? homeFor(auth.role ?? 'WORKER'));
  } catch (e) {
    error.value =
      e instanceof ApiError && e.status === 429
        ? 'Too many attempts. Please wait a few minutes and try again.'
        : e instanceof ApiError && e.status === 401
          ? 'That email and password don’t match.'
          : e instanceof ApiError && e.code === 'ACCOUNT_DISABLED'
            ? 'This account has been deactivated.'
            : 'We couldn’t sign you in. Please try again.';
    password.value = '';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <AuthHeading title="Welcome back" subtitle="Sign in to keep your time on track." />
    <form class="flex flex-col gap-4" novalidate @submit.prevent="submit">
      <TextField
        v-model="email"
        label="Email"
        type="email"
        autocomplete="username"
        icon="mail"
        placeholder="you@company.com"
        required
        autofocus
      />
      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between">
          <label for="password" class="text-[13px] font-medium text-ink">Password</label>
          <RouterLink to="/forgot-password" class="text-[13px] text-accent-ink hover:underline"
            >Forgot password?</RouterLink
          >
        </div>
        <div class="relative">
          <AppIcon
            name="lock"
            :size="16"
            class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-faint"
          />
          <input
            id="password"
            v-model="password"
            type="password"
            autocomplete="current-password"
            class="field pl-9"
            required
            :aria-invalid="error ? 'true' : undefined"
          />
        </div>
      </div>
      <Transition name="fade">
        <p
          v-if="error"
          class="flex items-center gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger"
          role="alert"
        >
          <AppIcon name="alert" :size="16" /> {{ error }}
        </p>
      </Transition>
      <BaseButton
        type="submit"
        variant="primary"
        size="lg"
        block
        :loading="busy"
        :disabled="!email || !password"
        class="mt-2"
        >Sign in</BaseButton
      >
    </form>
    <p class="mt-8 text-center text-[13px] text-faint">TEMPO accounts are created by invitation.</p>
  </div>
</template>
