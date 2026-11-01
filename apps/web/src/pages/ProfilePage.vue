<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { checkPasswordPolicy, UserRole, type TwoFactorSetupResponse } from '@tempo/shared';
import { authApi } from '../api/auth.ts';
import { ApiError } from '../api/client.ts';
import OtpInput from '../components/auth/OtpInput.vue';
import PasswordChecklist from '../components/auth/PasswordChecklist.vue';
import RecoveryCodes from '../components/auth/RecoveryCodes.vue';
import TimezoneSelect from '../components/auth/TimezoneSelect.vue';
import TotpSecret from '../components/auth/TotpSecret.vue';
import AppIcon from '../components/ui/AppIcon.vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseModal from '../components/ui/BaseModal.vue';
import StatusBadge from '../components/ui/StatusBadge.vue';
import TextField from '../components/ui/TextField.vue';
import UserAvatar from '../components/ui/UserAvatar.vue';
import { deviceTimeZone, utcOffsetLabel } from '../lib/time.ts';
import { useAuthStore } from '../stores/auth.ts';
import { useToastStore } from '../stores/toasts.ts';

const auth = useAuthStore();
const toasts = useToastStore();
const router = useRouter();
const user = computed(() => auth.user);

// ── profile ──
const name = ref(user.value?.name ?? '');
const timezone = ref<string | null>(user.value?.timezone ?? null);
watch(user, (u) => {
  if (!u) return;
  name.value = u.name;
  timezone.value = u.timezone;
});
const profileDirty = computed(
  () => name.value.trim() !== user.value?.name || timezone.value !== user.value?.timezone,
);
const savingProfile = ref(false);
async function saveProfile(): Promise<void> {
  if (!timezone.value) return;
  savingProfile.value = true;
  try {
    await auth.updateProfile({ name: name.value.trim(), timezone: timezone.value });
    toasts.success('Profile saved');
  } catch (e) {
    toasts.error(e, 'Could not save your profile');
  } finally {
    savingProfile.value = false;
  }
}

// ── password ──
const current = ref('');
const next = ref('');
const passwordError = ref<string | null>(null);
const savingPassword = ref(false);
const passwordValid = computed(
  () =>
    current.value.length > 0 &&
    checkPasswordPolicy(next.value, { email: user.value?.email, name: user.value?.name }).length ===
      0,
);
async function changePassword(): Promise<void> {
  savingPassword.value = true;
  passwordError.value = null;
  try {
    await authApi.changePassword({ currentPassword: current.value, newPassword: next.value });
    current.value = '';
    next.value = '';
    toasts.success('Password changed', 'Your other sessions were signed out.');
  } catch (e) {
    passwordError.value =
      e instanceof ApiError && e.code === 'INVALID_CREDENTIALS'
        ? 'Your current password isn’t right.'
        : e instanceof ApiError
          ? e.message
          : 'Please try again.';
  } finally {
    savingPassword.value = false;
  }
}

// ── 2FA (optional for everyone but Super Admins) ──
const twoFactorOpen = ref(false);
const setup = ref<TwoFactorSetupResponse | null>(null);
const recovery = ref<string[] | null>(null);
const twoFactorError = ref<string | null>(null);
const disablePassword = ref('');
const otp = ref<InstanceType<typeof OtpInput> | null>(null);
const isAdmin = computed(() => user.value?.role === UserRole.SUPER_ADMIN);

async function openTwoFactor(): Promise<void> {
  twoFactorError.value = null;
  recovery.value = null;
  setup.value = null;
  disablePassword.value = '';
  twoFactorOpen.value = true;
  if (!user.value?.twoFactorEnabled) {
    try {
      setup.value = await authApi.startTwoFactorSetup();
    } catch (e) {
      twoFactorError.value = e instanceof ApiError ? e.message : 'Please try again.';
    }
  }
}

async function enableTwoFactor(code: string): Promise<void> {
  try {
    recovery.value = (await authApi.enableTwoFactor(code)).recoveryCodes;
    await auth.reload();
  } catch {
    twoFactorError.value = 'That code isn’t right.';
    otp.value?.clear();
  }
}

async function disableTwoFactor(code: string): Promise<void> {
  try {
    await authApi.disableTwoFactor(disablePassword.value, code);
    await auth.reload();
    twoFactorOpen.value = false;
    toasts.success('Two-factor authentication turned off');
  } catch {
    twoFactorError.value = 'Password or code isn’t right.';
    otp.value?.clear();
  }
}

// ── sessions ──
const signingOut = ref(false);
async function signOutEverywhere(): Promise<void> {
  signingOut.value = true;
  try {
    await authApi.logoutAll();
    auth.clear();
    await router.push('/login');
  } finally {
    signingOut.value = false;
  }
}
const device = deviceTimeZone();
</script>

<template>
  <div v-if="user" class="mx-auto max-w-3xl">
    <div class="mb-8 flex items-center gap-4">
      <UserAvatar :name="user.name" :size="56" />
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">{{ user.name }}</h1>
        <p class="text-sm text-muted">{{ user.email }}</p>
      </div>
    </div>

    <div class="flex flex-col gap-6">
      <section class="card p-6">
        <h2 class="text-[15px] font-semibold text-ink">Profile</h2>
        <p class="mt-1 text-sm text-muted">
          Your timezone decides what “today” is, how days are split and how reports group time.
        </p>
        <form class="mt-5 grid gap-4 sm:grid-cols-2" @submit.prevent="saveProfile">
          <TextField v-model="name" label="Name" autocomplete="name" maxlength="100" />
          <div>
            <TimezoneSelect v-model="timezone" label="Timezone" />
            <p class="mt-1.5 text-[12.5px] text-faint">
              {{ timezone ? utcOffsetLabel(timezone) : '' }}
              <template v-if="timezone !== device"> · this device: {{ device }}</template>
            </p>
          </div>
          <div class="sm:col-span-2">
            <BaseButton
              type="submit"
              variant="primary"
              :disabled="!profileDirty || !name.trim()"
              :loading="savingProfile"
              >Save changes</BaseButton
            >
          </div>
        </form>
      </section>

      <section class="card p-6">
        <h2 class="text-[15px] font-semibold text-ink">Password</h2>
        <p class="mt-1 text-sm text-muted">Changing it signs out your other sessions.</p>
        <form class="mt-5 grid gap-4 sm:grid-cols-2" @submit.prevent="changePassword">
          <TextField
            v-model="current"
            label="Current password"
            type="password"
            autocomplete="current-password"
            :error="passwordError"
          />
          <div class="flex flex-col gap-3">
            <TextField
              v-model="next"
              label="New password"
              type="password"
              autocomplete="new-password"
            />
            <PasswordChecklist v-if="next" :password="next" :email="user.email" :name="user.name" />
          </div>
          <div class="sm:col-span-2">
            <BaseButton type="submit" :disabled="!passwordValid" :loading="savingPassword"
              >Change password</BaseButton
            >
          </div>
        </form>
      </section>

      <section class="card flex flex-wrap items-center gap-4 p-6">
        <div
          class="flex size-10 items-center justify-center rounded-xl bg-accent-soft text-accent-ink"
        >
          <AppIcon name="shield" :size="20" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 class="flex items-center gap-2 text-[15px] font-semibold text-ink">
            Two-factor authentication
            <StatusBadge :tone="user.twoFactorEnabled ? 'success' : 'neutral'" dot>{{
              user.twoFactorEnabled ? 'On' : 'Off'
            }}</StatusBadge>
          </h2>
          <p class="mt-1 text-sm text-muted">
            {{
              isAdmin
                ? 'Required for Super Admins.'
                : 'A code from your phone in addition to your password.'
            }}
          </p>
        </div>
        <BaseButton
          v-if="!isAdmin"
          :variant="user.twoFactorEnabled ? 'ghost' : 'secondary'"
          @click="openTwoFactor"
        >
          {{ user.twoFactorEnabled ? 'Turn off' : 'Set up' }}
        </BaseButton>
      </section>

      <section class="card flex flex-wrap items-center gap-4 p-6">
        <div class="min-w-0 flex-1">
          <h2 class="text-[15px] font-semibold text-ink">Sessions</h2>
          <p class="mt-1 text-sm text-muted">
            Sign out on every browser and device, including this one.
          </p>
        </div>
        <BaseButton icon="logout" :loading="signingOut" @click="signOutEverywhere"
          >Sign out everywhere</BaseButton
        >
      </section>
    </div>

    <BaseModal
      v-model:open="twoFactorOpen"
      :title="
        user.twoFactorEnabled
          ? 'Turn off two-factor authentication'
          : 'Set up two-factor authentication'
      "
    >
      <div v-if="recovery">
        <p class="mb-4 text-sm text-muted">
          Save these recovery codes. Each signs you in once if you lose your phone.
        </p>
        <RecoveryCodes :codes="recovery" />
      </div>
      <div v-else-if="user.twoFactorEnabled" class="flex flex-col gap-4">
        <TextField
          v-model="disablePassword"
          label="Password"
          type="password"
          autocomplete="current-password"
        />
        <div>
          <p class="mb-2 text-[13px] font-medium text-ink">Code from your app</p>
          <OtpInput ref="otp" :disabled="!disablePassword" @complete="disableTwoFactor" />
        </div>
      </div>
      <div v-else class="flex flex-col gap-5">
        <TotpSecret v-if="setup" :secret="setup.secret" :otpauth-url="setup.otpauthUrl" />
        <div v-if="setup">
          <p class="mb-2 text-[13px] font-medium text-ink">Code from your app</p>
          <OtpInput ref="otp" @complete="enableTwoFactor" />
        </div>
      </div>
      <p v-if="twoFactorError" class="mt-4 text-sm text-danger" role="alert">
        {{ twoFactorError }}
      </p>
      <template v-if="recovery" #footer>
        <BaseButton variant="primary" @click="twoFactorOpen = false">Done</BaseButton>
      </template>
    </BaseModal>
  </div>
</template>
