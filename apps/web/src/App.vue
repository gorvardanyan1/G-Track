<script setup lang="ts">
import ToastHost from './components/ui/ToastHost.vue';
import { useSession } from './composables/useSession.ts';
import { useThemeStore } from './stores/theme.ts';

useThemeStore();
useSession();
</script>

<template>
  <RouterView />
  <ToastHost />
</template>
