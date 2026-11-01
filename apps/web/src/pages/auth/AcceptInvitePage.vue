<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { checkPasswordPolicy, type InviteResponse } from '@tempo/shared';
import { authApi } from '../../api/auth.ts';
import { ApiError } from '../../api/client.ts';
import AuthHeading from '../../components/auth/AuthHeading.vue';
import PasswordChecklist from '../../components/auth/PasswordChecklist.vue';
import TimezoneSelect from '../../components/auth/TimezoneSelect.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import SkeletonBlock from '../../components/ui/SkeletonBlock.vue';
import StatusBadge from '../../components/ui/StatusBadge.vue';
import TextField from '../../components/ui/TextField.vue';
import { deviceTimeZone } from '../../lib/time.ts';
import { tokenFromHash } from '../../lib/url.ts';
import { homeFor } from '../../router/guards.ts';
import { useAuthStore } from '../../stores/auth.ts';

const auth = useAuthStore();
const router = useRouter();
const token = ref<string | null>(null);
const invite = ref<InviteResponse | null>(null);
const state = ref<'loading' | 'ready' | 'invalid'>('loading');
const name = ref('');
const password = ref('');
const timezone = ref<string | null>(deviceTimeZone());
const busy = ref(false);
const error = ref<string | null>(null);

const ROLE = {
  SUPER_ADMIN: 'Super Admin',
  PROJECT_MANAGER: 'Project manager',
  WORKER: 'Worker',
} as const;

onMounted(async () => {
  token.value = tokenFromHash(window.location.hash);
  history.replaceState(history.state, '', window.location.pathname);
  if (!token.value) return void (state.value = 'invalid');
  try {
    invite.value = await authApi.inspectInvite(token.value);
    state.value = 'ready';
  } catch {
    state.value = 'invalid';
  }
});

const valid = computed(
  () =>
    name.value.trim().length > 0 &&
    timezone.value !== null &&
    checkPasswordPolicy(password.value, { email: invite.value?.email, name: name.value }).length ===
      0,
);

async function submit(): Promise<void> {
  if (!token.value || !timezone.value) return;
  busy.value = true;
  error.value = null;
  try {
    const step = await auth.acceptInvite({
      token: token.value,
      name: name.value.trim(),
      password: password.value,
      timezone: timezone.value,
    });
    await router.replace(
      step === 'two_factor_setup' ? '/login/2fa-setup' : homeFor(auth.role ?? 'WORKER'),
    );
  } catch (e) {
    error.value =
      e instanceof ApiError && e.code === 'PASSWORD_POLICY'
        ? e.message
        : 'This invitation can’t be used any more. Ask your admin for a new one.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <div v-if="state === 'loading'" class="flex flex-col gap-3">
      <SkeletonBlock height="2rem" width="70%" />
      <SkeletonBlock height="1rem" width="90%" />
      <SkeletonBlock height="2.5rem" class="mt-6" />
      <SkeletonBlock height="2.5rem" />
    </div>
    <div v-else-if="state === 'invalid'">
      <AuthHeading
        title="Invitation not valid"
        subtitle="The link may have expired (invitations last 48 hours) or already been used. Ask your admin to send a new one."
      />
      <RouterLink to="/login" class="text-sm text-accent-ink hover:underline"
        >Go to sign in</RouterLink
      >
    </div>
    <div v-else-if="invite">
      <AuthHeading title="Join TEMPO" subtitle="Set up your account to start tracking.">
        <template #subtitle>
          You’re invited as <StatusBadge tone="accent">{{ ROLE[invite.role] }}</StatusBadge> with
          <span class="font-medium text-ink">{{ invite.email }}</span
          >.
        </template>
      </AuthHeading>
      <form class="flex flex-col gap-4" @submit.prevent="submit">
        <TextField v-model="name" label="Your name" autocomplete="name" required autofocus />
        <TimezoneSelect v-model="timezone" label="Timezone" />
        <p class="-mt-2 text-[12.5px] text-faint">
          Your days, “today” and reports follow this timezone. You can change it later.
        </p>
        <TextField
          v-model="password"
          label="Password"
          type="password"
          autocomplete="new-password"
          required
        />
        <PasswordChecklist :password="password" :email="invite.email" :name="name" />
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
          >Create account</BaseButton
        >
      </form>
    </div>
  </div>
</template>
