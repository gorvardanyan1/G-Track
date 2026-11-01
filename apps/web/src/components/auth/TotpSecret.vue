<script setup lang="ts">
import { computed, ref } from 'vue';
import AppIcon from '../ui/AppIcon.vue';
import BaseButton from '../ui/BaseButton.vue';

/** The authenticator secret, grouped for typing, plus a link that opens an authenticator app. */
const props = defineProps<{ secret: string; otpauthUrl: string }>();
const grouped = computed(() => props.secret.match(/.{1,4}/g)?.join(' ') ?? props.secret);
const copied = ref(false);

async function copy(): Promise<void> {
  await navigator.clipboard?.writeText(props.secret).catch(() => undefined);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}
</script>

<template>
  <div class="rounded-2xl border border-line bg-surface-2/60 p-4">
    <p class="text-xs font-medium tracking-wide text-faint uppercase">Setup key</p>
    <p class="num mt-1.5 text-[17px] font-medium break-all text-ink select-all">{{ grouped }}</p>
    <div class="mt-3 flex flex-wrap gap-2">
      <BaseButton size="sm" :icon="copied ? 'check' : 'copy'" @click="copy">{{
        copied ? 'Copied' : 'Copy key'
      }}</BaseButton>
      <a
        :href="otpauthUrl"
        class="inline-flex h-8 items-center gap-2 rounded-[10px] px-2.5 text-[13px] font-medium text-accent-ink hover:bg-accent-soft"
      >
        <AppIcon name="key" :size="15" /> Open in authenticator app
      </a>
    </div>
    <p class="mt-3 text-[12.5px] text-faint">
      In Google Authenticator, 1Password, Authy…: add an account → enter a setup key.
    </p>
  </div>
</template>
