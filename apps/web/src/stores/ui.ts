import { defineStore } from 'pinia';
import { ref } from 'vue';
import { readStorage, writeStorage } from '../lib/storage.ts';

export interface ManualEntryPrefill {
  date?: string;
  start?: string;
  end?: string;
}

/** Layout state: sidebar, and the global "new manual entry" dialog (shortcut N, calendar drag). */
export const useUiStore = defineStore('ui', () => {
  const sidebarCollapsed = ref(readStorage('tempo.sidebar') === 'collapsed');
  const mobileNavOpen = ref(false);
  const manualEntry = ref<{ open: boolean; prefill: ManualEntryPrefill }>({
    open: false,
    prefill: {},
  });

  return {
    sidebarCollapsed,
    mobileNavOpen,
    manualEntry,
    toggleSidebar() {
      sidebarCollapsed.value = !sidebarCollapsed.value;
      writeStorage('tempo.sidebar', sidebarCollapsed.value ? 'collapsed' : null);
    },
    openManualEntry(prefill: ManualEntryPrefill = {}) {
      manualEntry.value = { open: true, prefill };
    },
  };
});
