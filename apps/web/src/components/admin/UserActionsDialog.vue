<script setup lang="ts">
import { ref, watch } from 'vue';
import type { UserResponse, UserRole } from '@tempo/shared';
import { usersApi } from '../../api/users.ts';
import { useToastStore } from '../../stores/toasts.ts';
import ConfirmDialog from '../ui/ConfirmDialog.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import { ROLE_LABEL, ROLE_OPTIONS } from './roles.ts';

export type UserAction = 'role' | 'deactivate' | 'activate' | 'revoke';

/** The confirmation step of one action on one user. */
const props = defineProps<{ user: UserResponse | null; action: UserAction | null }>();
const emit = defineEmits<{ close: []; done: [user: UserResponse | null] }>();
const toasts = useToastStore();
const role = ref<UserRole>('WORKER');
const busy = ref(false);
watch(
  () => props.user,
  (user) => user && (role.value = user.role),
);

const TITLES: Record<UserAction, string> = {
  role: 'Change role',
  deactivate: 'Deactivate this account?',
  activate: 'Reactivate this account?',
  revoke: 'Sign out everywhere?',
};

async function confirm(): Promise<void> {
  const { user, action } = props;
  if (!user || !action) return;
  busy.value = true;
  try {
    if (action === 'role') {
      if (role.value === user.role) return emit('close');
      const updated = await usersApi.changeRole(user.id, role.value);
      toasts.success(
        'Role changed',
        `${updated.name} is now ${ROLE_LABEL[updated.role].toLowerCase()}.`,
      );
      emit('done', updated);
    } else if (action === 'revoke') {
      await usersApi.revokeSessions(user.id);
      toasts.success('Signed out everywhere', `${user.name} must sign in again.`);
      emit('done', null);
    } else {
      const updated = await usersApi.setActive(user.id, action === 'activate');
      toasts.success(
        updated.isActive ? 'Account reactivated' : 'Account deactivated',
        updated.name,
      );
      emit('done', updated);
    }
  } catch (e) {
    toasts.error(e, 'That didn’t work');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <ConfirmDialog
    :open="user !== null && action !== null"
    :title="action ? TITLES[action] : ''"
    :confirm-label="
      action === 'role'
        ? 'Save'
        : action === 'revoke'
          ? 'Sign out'
          : action === 'activate'
            ? 'Reactivate'
            : 'Deactivate'
    "
    :tone="action === 'deactivate' || action === 'revoke' ? 'danger' : 'primary'"
    :loading="busy"
    @update:open="(v) => !v && emit('close')"
    @confirm="confirm"
  >
    <template v-if="user && action === 'role'">
      <p class="mb-4">
        Choose what <strong class="text-ink">{{ user.name }}</strong> can do.
      </p>
      <SegmentedControl v-model="role" label="Role" :options="ROLE_OPTIONS" />
      <p
        v-if="role === 'SUPER_ADMIN' && !user.twoFactorEnabled"
        class="mt-3 text-[13px] text-warning"
      >
        They’ll have to set up two-factor authentication before they can continue.
      </p>
    </template>
    <template v-else-if="user && action === 'deactivate'">
      <strong class="text-ink">{{ user.name }}</strong> is signed out on every device, a running
      timer is stopped, and they can’t sign in until you reactivate them. Their time stays in
      reports.
    </template>
    <template v-else-if="user && action === 'activate'">
      <strong class="text-ink">{{ user.name }}</strong> can sign in again with their password.
    </template>
    <template v-else-if="user">
      Every session of <strong class="text-ink">{{ user.name }}</strong> ends now; they stay active
      and can sign in again.
    </template>
  </ConfirmDialog>
</template>
