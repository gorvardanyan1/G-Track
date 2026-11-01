<script setup lang="ts">
import { ref, watch } from 'vue';
import type { UserRole } from '@tempo/shared';
import { ApiError } from '../../api/client.ts';
import { usersApi } from '../../api/users.ts';
import { useToastStore } from '../../stores/toasts.ts';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import FormField from '../ui/FormField.vue';
import SegmentedControl from '../ui/SegmentedControl.vue';
import TextField from '../ui/TextField.vue';
import { ROLE_OPTIONS } from './roles.ts';

const open = defineModel<boolean>('open', { default: false });
const emit = defineEmits<{ invited: [] }>();
const toasts = useToastStore();

const email = ref('');
const role = ref<UserRole>('WORKER');
const error = ref<string | null>(null);
const sending = ref(false);
watch(open, (isOpen) => {
  if (!isOpen) return;
  email.value = '';
  role.value = 'WORKER';
  error.value = null;
});

async function send(): Promise<void> {
  error.value = null;
  if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) {
    error.value = 'Enter an email address';
    return;
  }
  sending.value = true;
  try {
    const invite = await usersApi.invite(email.value.trim(), role.value);
    toasts.success('Invitation sent', `${invite.email} has 48 hours to accept it.`);
    emit('invited');
    open.value = false;
  } catch (e) {
    if (e instanceof ApiError && (e.status === 409 || e.status === 400)) error.value = e.message;
    else toasts.error(e, 'Could not send the invitation');
  } finally {
    sending.value = false;
  }
}
</script>

<template>
  <BaseModal
    v-model:open="open"
    title="Invite someone"
    description="They get an email with a link to set their name, password and timezone."
  >
    <form id="invite-form" class="space-y-4" @submit.prevent="send">
      <TextField
        v-model="email"
        label="Email"
        type="email"
        icon="mail"
        autocomplete="off"
        placeholder="name@company.com"
        :error="error"
        autofocus
      />
      <FormField label="Role">
        <SegmentedControl v-model="role" label="Role" :options="ROLE_OPTIONS" />
      </FormField>
      <p
        v-if="role === 'SUPER_ADMIN'"
        class="rounded-xl bg-warning-soft p-3 text-[13px] text-warning"
      >
        Super admins can see and change everything, and must set up two-factor authentication when
        they first sign in.
      </p>
    </form>
    <template #footer>
      <BaseButton variant="ghost" @click="open = false">Cancel</BaseButton>
      <BaseButton variant="primary" icon="send" type="submit" form="invite-form" :loading="sending"
        >Send invitation</BaseButton
      >
    </template>
  </BaseModal>
</template>
