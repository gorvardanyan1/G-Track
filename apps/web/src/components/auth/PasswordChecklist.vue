<script setup lang="ts">
import { computed } from 'vue';
import { checkPasswordPolicy, PASSWORD_ISSUE_MESSAGES, type PasswordIssue } from '@tempo/shared';
import AppIcon from '../ui/AppIcon.vue';

/** The same policy the api enforces, checked as the user types. */
const props = defineProps<{ password: string; email?: string; name?: string }>();
const issues = computed(
  () => new Set(checkPasswordPolicy(props.password, { email: props.email, name: props.name })),
);
const rules: PasswordIssue[] = [
  'TOO_SHORT',
  'TOO_COMMON',
  'CONTAINS_PERSONAL_INFO',
  'REPEATED_CHARACTERS',
];
const label = (rule: PasswordIssue) =>
  rule === 'TOO_SHORT'
    ? PASSWORD_ISSUE_MESSAGES.TOO_SHORT
    : PASSWORD_ISSUE_MESSAGES[rule].replace(
        /^This password is too common$/,
        'Not a common password',
      );
</script>

<template>
  <ul class="grid gap-1.5 text-[13px]" aria-live="polite">
    <li
      v-for="rule in rules"
      :key="rule"
      class="flex items-center gap-2 transition-colors"
      :class="password && !issues.has(rule) ? 'text-running' : 'text-faint'"
    >
      <AppIcon :name="password && !issues.has(rule) ? 'check' : 'info'" :size="14" :stroke="2" />
      {{ label(rule) }}
    </li>
  </ul>
</template>
