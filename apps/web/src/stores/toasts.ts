import { defineStore } from 'pinia';
import { ref } from 'vue';
import { ApiError } from '../api/client.ts';

export type ToastTone = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message?: string;
  action?: { label: string; run: () => void };
}

let nextId = 1;

export const useToastStore = defineStore('toasts', () => {
  const items = ref<Toast[]>([]);

  function dismiss(id: number): void {
    items.value = items.value.filter((t) => t.id !== id);
  }

  function push(toast: Omit<Toast, 'id'>, durationMs = toast.tone === 'error' ? 6000 : 3500) {
    const id = nextId++;
    items.value = [...items.value.slice(-3), { ...toast, id }];
    setTimeout(() => dismiss(id), durationMs);
    return id;
  }

  return {
    items,
    dismiss,
    success: (title: string, message?: string) =>
      push({ tone: 'success', title, ...(message && { message }) }),
    info: (title: string, message?: string) =>
      push({ tone: 'info', title, ...(message && { message }) }),
    /** Shows an api error's message (or a generic one for anything unexpected). */
    error: (error: unknown, title = 'Something went wrong') =>
      push({
        tone: 'error',
        title,
        message: error instanceof ApiError ? error.message : 'Please try again in a moment.',
      }),
    push,
  };
});
