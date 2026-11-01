<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import IconButton from './IconButton.vue';

withDefaults(defineProps<{ title: string; description?: string; size?: 'sm' | 'md' | 'lg' }>(), {
  size: 'md',
});
const open = defineModel<boolean>('open', { default: false });
const panel = ref<HTMLElement | null>(null);
let returnFocus: HTMLElement | null = null;

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

function onKey(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    open.value = false;
  } else if (event.key === 'Tab' && panel.value) {
    // Keep focus inside the dialog.
    const items = [...panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
}

watch(
  open,
  async (isOpen) => {
    if (isOpen) {
      returnFocus = document.activeElement as HTMLElement | null;
      document.addEventListener('keydown', onKey);
      document.body.style.overflow = 'hidden';
      await nextTick();
      const target =
        panel.value?.querySelector<HTMLElement>('[autofocus]') ??
        panel.value?.querySelector<HTMLElement>('input,select,textarea') ??
        panel.value;
      target?.focus();
    } else {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      returnFocus?.focus();
    }
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKey);
  document.body.style.overflow = '';
});
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="open"
        class="fixed inset-0 z-[60] bg-[rgb(10_10_20/0.35)] backdrop-blur-[2px] dark:bg-[rgb(0_0_0/0.55)]"
        @click="open = false"
      />
    </Transition>
    <Transition name="pop">
      <div
        v-if="open"
        class="pointer-events-none fixed inset-0 z-[61] flex items-start justify-center overflow-y-auto p-4 pt-[10vh]"
      >
        <section
          ref="panel"
          role="dialog"
          aria-modal="true"
          :aria-label="title"
          tabindex="-1"
          class="pointer-events-auto w-full rounded-2xl border border-line bg-surface shadow-pop outline-none"
          :class="{ sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size]"
        >
          <header class="flex items-start justify-between gap-4 px-6 pt-5">
            <div>
              <h2 class="text-base font-semibold tracking-tight text-ink">{{ title }}</h2>
              <p v-if="description" class="mt-1 text-sm text-muted">{{ description }}</p>
            </div>
            <IconButton icon="x" label="Close" size="sm" class="-mr-2" @click="open = false" />
          </header>
          <div class="px-6 pt-4 pb-6"><slot /></div>
          <footer
            v-if="$slots['footer']"
            class="flex items-center justify-end gap-2 rounded-b-2xl border-t border-line bg-surface-2/50 px-6 py-3.5"
          >
            <slot name="footer" />
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
