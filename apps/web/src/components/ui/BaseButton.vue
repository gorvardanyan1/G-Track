<script setup lang="ts">
import AppIcon from './AppIcon.vue';
import type { IconName } from './icons.ts';

withDefaults(
  defineProps<{
    variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
    size?: 'sm' | 'md' | 'lg';
    icon?: IconName;
    iconRight?: IconName;
    loading?: boolean;
    disabled?: boolean;
    type?: 'button' | 'submit';
    block?: boolean;
  }>(),
  { variant: 'secondary', size: 'md', type: 'button' },
);
</script>

<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading || undefined"
    class="relative inline-flex items-center justify-center gap-2 rounded-[10px] font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow,transform] duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50"
    :class="[
      block && 'w-full',
      {
        sm: 'h-8 px-2.5 text-[13px]',
        md: 'h-9 px-3.5 text-sm',
        lg: 'h-11 px-5 text-[15px]',
      }[size],
      {
        primary:
          'bg-accent text-white shadow-[0_1px_2px_rgb(30_30_120/0.25),inset_0_1px_0_rgb(255_255_255/0.15)] hover:bg-accent-hover',
        secondary:
          'border border-line bg-surface text-ink shadow-card hover:border-line-strong hover:bg-surface-2',
        ghost: 'text-muted hover:bg-surface-2 hover:text-ink',
        subtle: 'bg-surface-2 text-ink hover:bg-surface-3',
        danger: 'bg-danger text-white hover:brightness-110',
      }[variant],
    ]"
  >
    <span
      v-if="loading"
      class="absolute inset-0 flex items-center justify-center"
      aria-hidden="true"
    >
      <span class="size-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
    </span>
    <span class="inline-flex items-center gap-2" :class="loading && 'invisible'">
      <AppIcon v-if="icon" :name="icon" :size="size === 'sm' ? 15 : 17" />
      <slot />
      <AppIcon v-if="iconRight" :name="iconRight" :size="size === 'sm' ? 15 : 17" />
    </span>
  </button>
</template>
