<script setup lang="ts">
import { useToastStore } from '../../stores/toasts.ts';
import AppIcon from './AppIcon.vue';

const toasts = useToastStore();
</script>

<template>
  <div
    class="pointer-events-none fixed right-4 bottom-4 z-[80] flex w-[min(380px,calc(100vw-2rem))] flex-col gap-2"
    aria-live="polite"
  >
    <TransitionGroup name="pop">
      <div
        v-for="toast in toasts.items"
        :key="toast.id"
        class="pointer-events-auto flex items-start gap-3 rounded-xl border border-line bg-surface p-3.5 pr-2.5 shadow-pop"
        :role="toast.tone === 'error' ? 'alert' : 'status'"
      >
        <span
          class="mt-px flex size-6 shrink-0 items-center justify-center rounded-full"
          :class="
            {
              success: 'bg-running-soft text-running',
              error: 'bg-danger-soft text-danger',
              info: 'bg-accent-soft text-accent-ink',
            }[toast.tone]
          "
        >
          <AppIcon
            :name="toast.tone === 'success' ? 'check' : toast.tone === 'error' ? 'alert' : 'info'"
            :size="14"
            :stroke="2.2"
          />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-ink">{{ toast.title }}</p>
          <p v-if="toast.message" class="mt-0.5 text-[13px] text-muted">{{ toast.message }}</p>
          <button
            v-if="toast.action"
            type="button"
            class="mt-1.5 text-[13px] font-medium text-accent-ink hover:underline"
            @click="
              toast.action.run();
              toasts.dismiss(toast.id);
            "
          >
            {{ toast.action.label }}
          </button>
        </div>
        <button
          type="button"
          class="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-ink"
          aria-label="Dismiss"
          @click="toasts.dismiss(toast.id)"
        >
          <AppIcon name="x" :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
