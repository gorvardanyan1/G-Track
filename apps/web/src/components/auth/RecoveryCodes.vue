<script setup lang="ts">
import { ref } from 'vue';
import BaseButton from '../ui/BaseButton.vue';

const props = defineProps<{ codes: readonly string[] }>();
const copied = ref(false);

async function copy(): Promise<void> {
  await navigator.clipboard?.writeText(props.codes.join('\n')).catch(() => undefined);
  copied.value = true;
  setTimeout(() => (copied.value = false), 1500);
}

function download(): void {
  const blob = new Blob([`TEMPO recovery codes\n\n${props.codes.join('\n')}\n`], {
    type: 'text/plain',
  });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'tempo-recovery-codes.txt';
  link.click();
  URL.revokeObjectURL(link.href);
}
</script>

<template>
  <div>
    <ol class="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface-2/60 p-4">
      <li
        v-for="code in codes"
        :key="code"
        class="num rounded-lg bg-surface px-3 py-2 text-center text-[15px] text-ink shadow-card"
      >
        {{ code }}
      </li>
    </ol>
    <div class="mt-3 flex gap-2">
      <BaseButton size="sm" :icon="copied ? 'check' : 'copy'" @click="copy">{{
        copied ? 'Copied' : 'Copy'
      }}</BaseButton>
      <BaseButton size="sm" icon="download" @click="download">Download</BaseButton>
    </div>
  </div>
</template>
