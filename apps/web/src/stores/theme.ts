import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { readStorage, writeStorage } from '../lib/storage.ts';

export type ThemePreference = 'system' | 'light' | 'dark';
const KEY = 'tempo.theme';

/** Light/dark mode: follows the system unless the user picks one. */
export const useThemeStore = defineStore('theme', () => {
  const stored = readStorage(KEY);
  const preference = ref<ThemePreference>(
    stored === 'light' || stored === 'dark' ? stored : 'system',
  );
  const media =
    typeof window === 'undefined' ? null : window.matchMedia('(prefers-color-scheme: dark)');
  const systemDark = ref(media?.matches ?? false);
  media?.addEventListener('change', (e) => {
    systemDark.value = e.matches;
    apply();
  });

  const isDark = computed(() =>
    preference.value === 'system' ? systemDark.value : preference.value === 'dark',
  );

  function apply(): void {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', isDark.value);
  }

  function set(value: ThemePreference): void {
    preference.value = value;
    writeStorage(KEY, value === 'system' ? null : value);
    apply();
  }

  apply();
  return { preference, isDark, set };
});
