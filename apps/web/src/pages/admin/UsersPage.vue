<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PendingInviteResponse, UserResponse, UserRole } from '@tempo/shared';
import { usersApi } from '../../api/users.ts';
import InviteModal from '../../components/admin/InviteModal.vue';
import UserActionsDialog, { type UserAction } from '../../components/admin/UserActionsDialog.vue';
import { ROLE_LABEL, ROLE_OPTIONS, ROLE_TONE } from '../../components/admin/roles.ts';
import AppIcon from '../../components/ui/AppIcon.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import DataTable from '../../components/ui/DataTable.vue';
import EmptyState from '../../components/ui/EmptyState.vue';
import IconButton from '../../components/ui/IconButton.vue';
import PaginationBar from '../../components/ui/PaginationBar.vue';
import SearchSelect from '../../components/ui/SearchSelect.vue';
import SegmentedControl from '../../components/ui/SegmentedControl.vue';
import StatusBadge from '../../components/ui/StatusBadge.vue';
import TextField from '../../components/ui/TextField.vue';
import UserAvatar from '../../components/ui/UserAvatar.vue';
import { useAuthStore } from '../../stores/auth.ts';
import { useToastStore } from '../../stores/toasts.ts';

const auth = useAuthStore();
const toasts = useToastStore();
const PAGE_SIZE = 20;
const zone = computed(() => auth.user?.timezone ?? 'UTC');

const search = ref('');
const role = ref<UserRole | 'all'>('all');
const status = ref<'active' | 'inactive' | 'all'>('active');
const page = ref(1);
const data = ref<{ items: UserResponse[]; total: number } | null>(null);
const loading = ref(true);
const invites = ref<PendingInviteResponse[]>([]);
const inviting = ref(false);
const target = ref<{ user: UserResponse; action: UserAction } | null>(null);

async function load(): Promise<void> {
  loading.value = true;
  try {
    data.value = await usersApi.list({
      search: search.value.trim(),
      ...(role.value !== 'all' && { role: role.value }),
      status: status.value,
      page: page.value,
      pageSize: PAGE_SIZE,
    });
  } catch (e) {
    toasts.error(e, 'Could not load users');
  } finally {
    loading.value = false;
  }
}
async function loadInvites(): Promise<void> {
  invites.value = await usersApi.invites().catch(() => []);
}
onMounted(() => void loadInvites());
watch(page, load, { immediate: true });
const reload = () => (page.value === 1 ? void load() : (page.value = 1));
watch([role, status], reload);
let debounce: ReturnType<typeof setTimeout> | undefined;
watch(search, () => {
  clearTimeout(debounce);
  debounce = setTimeout(reload, 250);
});
onBeforeUnmount(() => clearTimeout(debounce));

function done(updated: UserResponse | null): void {
  target.value = null;
  if (updated && data.value)
    data.value = {
      ...data.value,
      items: data.value.items.map((u) => (u.id === updated.id ? updated : u)),
    };
}
async function revokeInvite(invite: PendingInviteResponse): Promise<void> {
  try {
    await usersApi.revokeInvite(invite.id);
    toasts.success('Invitation withdrawn', invite.email);
    await loadInvites();
  } catch (e) {
    toasts.error(e, 'Could not withdraw the invitation');
  }
}

const dateTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat(undefined, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: zone.value,
      }).format(new Date(iso))
    : 'Never';
const ROLE_FILTER = [{ value: 'all', label: 'All roles' }, ...ROLE_OPTIONS];
const STATUS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Deactivated' },
  { value: 'all', label: 'All' },
] as const;
const columns = [
  { key: 'user', label: 'Person' },
  { key: 'role', label: 'Role' },
  { key: 'security', label: '2FA' },
  { key: 'timezone', label: 'Timezone' },
  { key: 'lastLogin', label: 'Last sign-in' },
  { key: 'actions', label: '', align: 'right' as const },
];
</script>

<template>
  <div>
    <div class="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight text-ink">Users</h1>
        <p class="mt-1 text-sm text-muted">
          Everyone in the organization. New people join by invitation.
        </p>
      </div>
      <BaseButton variant="primary" icon="plus" @click="inviting = true">Invite</BaseButton>
    </div>

    <section v-if="invites.length" class="card mb-6">
      <h2 class="px-5 pt-4 pb-2 text-sm font-semibold text-ink">
        Pending invitations <span class="font-normal text-faint">{{ invites.length }}</span>
      </h2>
      <ul class="divide-y divide-line">
        <li v-for="invite in invites" :key="invite.id" class="flex items-center gap-3 px-5 py-2.5">
          <span class="flex size-7 items-center justify-center rounded-full bg-surface-2 text-faint"
            ><AppIcon name="mail" :size="14"
          /></span>
          <span class="min-w-0 flex-1 truncate text-sm text-ink">{{ invite.email }}</span>
          <StatusBadge :tone="ROLE_TONE[invite.role]">{{ ROLE_LABEL[invite.role] }}</StatusBadge>
          <span class="hidden text-xs text-faint sm:inline"
            >expires {{ dateTime(invite.expiresAt) }}</span
          >
          <IconButton
            icon="x"
            size="sm"
            tone="danger"
            :label="`Withdraw invitation for ${invite.email}`"
            @click="revokeInvite(invite)"
          />
        </li>
      </ul>
    </section>

    <section class="card overflow-hidden">
      <div class="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <div class="w-full sm:w-64">
          <TextField
            v-model="search"
            icon="search"
            placeholder="Search name or email"
            aria-label="Search users"
          />
        </div>
        <div class="w-44">
          <SearchSelect
            :model-value="role"
            :options="ROLE_FILTER"
            aria-label="Role"
            @update:model-value="(v) => (role = (v ?? 'all') as UserRole | 'all')"
          />
        </div>
        <SegmentedControl v-model="status" :options="STATUS" label="Status" />
      </div>
      <DataTable
        :columns="columns"
        :rows="data?.items ?? []"
        :row-key="(u) => u.id"
        :loading="loading && !data"
      >
        <template #user="{ row }">
          <span class="flex items-center gap-3" :class="!row.isActive && 'opacity-60'">
            <UserAvatar :name="row.name" :size="30" />
            <span class="min-w-0">
              <span class="flex items-center gap-2 font-medium whitespace-nowrap text-ink">
                {{ row.name }}
                <span v-if="row.id === auth.user?.id" class="text-xs font-normal text-faint"
                  >(you)</span
                >
                <StatusBadge v-if="!row.isActive" tone="danger">Deactivated</StatusBadge>
              </span>
              <span class="block truncate text-xs text-faint">{{ row.email }}</span>
            </span>
          </span>
        </template>
        <template #role="{ row }">
          <StatusBadge :tone="ROLE_TONE[row.role]">{{ ROLE_LABEL[row.role] }}</StatusBadge>
        </template>
        <template #security="{ row }">
          <span
            class="flex items-center gap-1.5 text-[13px]"
            :class="row.twoFactorEnabled ? 'text-running' : 'text-faint'"
          >
            <AppIcon :name="row.twoFactorEnabled ? 'lock' : 'key'" :size="14" />
            {{ row.twoFactorEnabled ? 'On' : 'Off' }}
          </span>
        </template>
        <template #timezone="{ row }"
          ><span class="text-[13px] whitespace-nowrap text-muted">{{
            row.timezone
          }}</span></template
        >
        <template #lastLogin="{ row }"
          ><span class="text-[13px] whitespace-nowrap text-muted">{{
            dateTime(row.lastLoginAt)
          }}</span></template
        >
        <template #actions="{ row }">
          <span v-if="row.id !== auth.user?.id" class="flex justify-end gap-0.5">
            <IconButton
              icon="users"
              size="sm"
              label="Change role"
              :disabled="!row.isActive"
              @click="target = { user: row, action: 'role' }"
            />
            <IconButton
              icon="logout"
              size="sm"
              label="Sign out everywhere"
              :disabled="!row.isActive"
              @click="target = { user: row, action: 'revoke' }"
            />
            <IconButton
              v-if="row.isActive"
              icon="lock"
              size="sm"
              tone="danger"
              label="Deactivate"
              @click="target = { user: row, action: 'deactivate' }"
            />
            <IconButton
              v-else
              icon="refresh"
              size="sm"
              label="Reactivate"
              @click="target = { user: row, action: 'activate' }"
            />
          </span>
        </template>
        <template #empty>
          <EmptyState
            art="compass"
            title="No one matches"
            description="Try another name, role or status."
          />
        </template>
      </DataTable>
      <PaginationBar
        v-if="data && data.total > PAGE_SIZE"
        v-model="page"
        :total="data.total"
        :page-size="PAGE_SIZE"
        noun="people"
      />
    </section>

    <InviteModal v-model:open="inviting" @invited="loadInvites" />
    <UserActionsDialog
      :user="target?.user ?? null"
      :action="target?.action ?? null"
      @close="target = null"
      @done="done"
    />
  </div>
</template>
