<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { navigationFor } from '../../router/navigation.ts';
import { useAuthStore } from '../../stores/auth.ts';
import { useThemeStore, type ThemePreference } from '../../stores/theme.ts';
import { useTimerStore } from '../../stores/timer.ts';
import { useUiStore } from '../../stores/ui.ts';
import AppIcon from '../ui/AppIcon.vue';
import type { IconName } from '../ui/icons.ts';
import BrandMark from './BrandMark.vue';

const auth = useAuthStore();
const ui = useUiStore();
const theme = useThemeStore();
const timer = useTimerStore();
const sections = computed(() => (auth.role ? navigationFor(auth.role) : []));

/**
 * Below the desktop breakpoint the sidebar is an off-canvas drawer: while it's closed it must
 * not be reachable with Tab or a screen reader, so it's inert.
 */
const desktopQuery =
  typeof window === 'undefined' ? null : window.matchMedia('(min-width: 1024px)');
const desktop = ref(desktopQuery?.matches ?? true);
const onMedia = (event: MediaQueryListEvent) => (desktop.value = event.matches);
desktopQuery?.addEventListener('change', onMedia);
onBeforeUnmount(() => desktopQuery?.removeEventListener('change', onMedia));
const themes: { value: ThemePreference; icon: IconName; label: string }[] = [
  { value: 'light', icon: 'sun', label: 'Light' },
  { value: 'dark', icon: 'moon', label: 'Dark' },
  { value: 'system', icon: 'monitor', label: 'System' },
];
</script>

<template>
  <Transition name="fade">
    <div
      v-if="ui.mobileNavOpen"
      class="fixed inset-0 z-40 bg-black/30 lg:hidden"
      @click="ui.mobileNavOpen = false"
    />
  </Transition>
  <aside
    class="fixed inset-y-0 left-0 z-50 flex flex-col border-r border-line bg-surface transition-[width,transform] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] lg:sticky lg:top-0 lg:h-dvh lg:translate-x-0"
    :class="[
      ui.sidebarCollapsed ? 'lg:w-[68px]' : 'lg:w-[244px]',
      ui.mobileNavOpen ? 'w-[264px] translate-x-0' : 'w-[264px] -translate-x-full',
    ]"
    aria-label="Main navigation"
    :inert="!desktop && !ui.mobileNavOpen"
  >
    <div
      class="flex h-16 items-center px-5"
      :class="ui.sidebarCollapsed && 'lg:justify-center lg:px-0'"
    >
      <BrandMark :compact="ui.sidebarCollapsed" class="max-lg:!flex" />
    </div>

    <nav class="scrollbar-thin flex-1 overflow-y-auto px-3 pb-4">
      <div v-for="section in sections" :key="section.title" class="mt-4 first:mt-1">
        <p
          class="mb-1 px-2.5 text-[11px] font-semibold tracking-wider text-faint uppercase"
          :class="ui.sidebarCollapsed && 'lg:invisible lg:h-0 lg:mb-0'"
        >
          {{ section.title }}
        </p>
        <RouterLink
          v-for="item in section.items"
          :key="item.to"
          v-slot="{ href, navigate, isActive }"
          :to="item.to"
          custom
        >
          <a
            :href="href"
            :title="ui.sidebarCollapsed ? item.label : undefined"
            class="group relative flex h-9 items-center gap-3 rounded-[10px] px-2.5 text-sm font-medium transition-colors duration-150"
            :class="[
              isActive
                ? 'bg-accent-soft text-accent-ink'
                : 'text-muted hover:bg-surface-2 hover:text-ink',
              ui.sidebarCollapsed && 'lg:justify-center lg:px-0',
            ]"
            :aria-current="isActive ? 'page' : undefined"
            @click="
              navigate($event);
              ui.mobileNavOpen = false;
            "
          >
            <AppIcon :name="item.icon" :size="18" />
            <span :class="ui.sidebarCollapsed && 'lg:sr-only'">{{ item.label }}</span>
            <span
              v-if="item.to === '/today' && timer.running"
              class="ml-auto size-2 rounded-full bg-running [animation:blink-dot_1.6s_ease-in-out_infinite]"
              :class="ui.sidebarCollapsed && 'lg:absolute lg:top-1.5 lg:right-2 lg:ml-0'"
              aria-label="Timer running"
            />
          </a>
        </RouterLink>
      </div>
    </nav>

    <div class="border-t border-line p-3">
      <div
        class="flex rounded-[10px] bg-surface-2 p-0.5"
        :class="ui.sidebarCollapsed && 'lg:flex-col'"
        role="radiogroup"
        aria-label="Theme"
      >
        <button
          v-for="t in themes"
          :key="t.value"
          type="button"
          role="radio"
          :aria-checked="theme.preference === t.value"
          :aria-label="t.label"
          :title="t.label"
          class="flex h-7 flex-1 items-center justify-center rounded-lg transition-all"
          :class="
            theme.preference === t.value
              ? 'bg-surface text-ink shadow-card'
              : 'text-faint hover:text-ink'
          "
          @click="theme.set(t.value)"
        >
          <AppIcon :name="t.icon" :size="15" />
        </button>
      </div>
      <button
        type="button"
        class="mt-2 hidden h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-[13px] text-faint transition-colors hover:bg-surface-2 hover:text-ink lg:flex"
        :class="ui.sidebarCollapsed && 'justify-center px-0'"
        :aria-label="ui.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'"
        @click="ui.toggleSidebar()"
      >
        <AppIcon name="sidebar" :size="16" />
        <span v-if="!ui.sidebarCollapsed">Collapse</span>
      </button>
    </div>
  </aside>
</template>
