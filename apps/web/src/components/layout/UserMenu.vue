<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../../stores/auth.ts';
import AppIcon from '../ui/AppIcon.vue';
import KeyHint from '../ui/KeyHint.vue';
import UserAvatar from '../ui/UserAvatar.vue';

const auth = useAuthStore();
const router = useRouter();
const open = ref(false);
const root = ref<HTMLElement | null>(null);

const ROLE_LABEL = {
  SUPER_ADMIN: 'Super Admin',
  PROJECT_MANAGER: 'Project manager',
  WORKER: 'Worker',
} as const;

function onOutside(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) open.value = false;
}
watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('pointerdown', onOutside);
  else document.removeEventListener('pointerdown', onOutside);
});
onBeforeUnmount(() => document.removeEventListener('pointerdown', onOutside));

async function signOut(): Promise<void> {
  open.value = false;
  await auth.logout();
  await router.push('/login');
}
</script>

<template>
  <div v-if="auth.user" ref="root" class="relative">
    <button
      type="button"
      class="flex items-center gap-2 rounded-full p-0.5 pr-0.5 transition-colors hover:bg-surface-2 sm:pr-2"
      :aria-expanded="open"
      aria-haspopup="menu"
      @click="open = !open"
      @keydown.esc="open = false"
    >
      <UserAvatar :name="auth.user.name" :size="32" />
      <AppIcon name="chevron-down" :size="14" class="hidden text-faint sm:block" />
    </button>
    <Transition name="pop">
      <div
        v-if="open"
        role="menu"
        class="absolute right-0 z-50 mt-2 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-pop"
      >
        <div class="flex items-center gap-3 px-2.5 py-2.5">
          <UserAvatar :name="auth.user.name" :size="36" />
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-ink">{{ auth.user.name }}</p>
            <p class="truncate text-xs text-faint">{{ auth.user.email }}</p>
          </div>
        </div>
        <p class="px-2.5 pb-2 text-xs text-faint">
          {{ ROLE_LABEL[auth.user.role] }} · {{ auth.user.timezone }}
        </p>
        <div class="my-1 h-px bg-line" />
        <RouterLink
          to="/profile"
          role="menuitem"
          class="flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink hover:bg-surface-2"
          @click="open = false"
        >
          <AppIcon name="user" :size="16" class="text-muted" /> Profile
        </RouterLink>
        <div class="flex h-9 items-center gap-2.5 px-2.5 text-sm text-muted">
          <AppIcon name="keyboard" :size="16" /> Shortcuts
          <span class="ml-auto flex items-center gap-1 text-xs"
            ><KeyHint>S</KeyHint> timer <KeyHint>N</KeyHint> new</span
          >
        </div>
        <div class="my-1 h-px bg-line" />
        <button
          type="button"
          role="menuitem"
          class="flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-sm text-ink hover:bg-surface-2"
          @click="signOut"
        >
          <AppIcon name="logout" :size="16" class="text-muted" /> Sign out
        </button>
      </div>
    </Transition>
  </div>
</template>
