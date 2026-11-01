<script setup lang="ts">
import BaseButton from './BaseButton.vue';
import BaseModal from './BaseModal.vue';

withDefaults(
  defineProps<{
    title: string;
    confirmLabel?: string;
    tone?: 'primary' | 'danger';
    loading?: boolean;
  }>(),
  { confirmLabel: 'Confirm', tone: 'primary' },
);
const open = defineModel<boolean>('open', { default: false });
defineEmits<{ confirm: [] }>();
</script>

<template>
  <BaseModal v-model:open="open" :title="title" size="sm">
    <div class="text-sm text-muted"><slot /></div>
    <template #footer>
      <BaseButton variant="ghost" @click="open = false">Cancel</BaseButton>
      <BaseButton :variant="tone" :loading="loading" @click="$emit('confirm')">{{
        confirmLabel
      }}</BaseButton>
    </template>
  </BaseModal>
</template>
