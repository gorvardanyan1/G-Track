<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';

/** Six digit boxes; typing or pasting fills them, and a full code is emitted once. */
const emit = defineEmits<{ complete: [string] }>();
defineProps<{ disabled?: boolean; invalid?: boolean }>();
const digits = ref<string[]>(['', '', '', '', '', '']);
const inputs = ref<HTMLInputElement[]>([]);

function focus(i: number): void {
  void nextTick(() => inputs.value[Math.max(0, Math.min(5, i))]?.focus());
}

function fill(from: number, text: string): void {
  const chars = text
    .replace(/\D/g, '')
    .slice(0, 6 - from)
    .split('');
  chars.forEach((c, k) => (digits.value[from + k] = c));
  focus(from + chars.length);
  const code = digits.value.join('');
  if (code.length === 6) emit('complete', code);
}

function onInput(i: number, event: Event): void {
  const input = event.target as HTMLInputElement;
  const value = input.value;
  digits.value[i] = '';
  input.value = '';
  fill(i, value);
}

function onKey(i: number, event: KeyboardEvent): void {
  if (event.key === 'Backspace' && !digits.value[i]) focus(i - 1);
  if (event.key === 'ArrowLeft') focus(i - 1);
  if (event.key === 'ArrowRight') focus(i + 1);
}

function onPaste(i: number, event: ClipboardEvent): void {
  event.preventDefault();
  fill(i, event.clipboardData?.getData('text') ?? '');
}

defineExpose({
  clear: () => {
    digits.value = ['', '', '', '', '', ''];
    focus(0);
  },
});
onMounted(() => focus(0));
</script>

<template>
  <div class="flex justify-between gap-2" role="group" aria-label="6-digit code">
    <input
      v-for="(digit, i) in digits"
      :key="i"
      :ref="
        (el) => {
          if (el) inputs[i] = el as HTMLInputElement;
        }
      "
      :value="digit"
      :disabled="disabled"
      inputmode="numeric"
      :autocomplete="i === 0 ? 'one-time-code' : 'off'"
      maxlength="6"
      :aria-label="`Digit ${i + 1}`"
      :aria-invalid="invalid ? 'true' : undefined"
      class="field num !h-14 !w-12 !px-0 text-center !text-xl font-semibold sm:!w-14"
      @input="onInput(i, $event)"
      @keydown="onKey(i, $event)"
      @paste="onPaste(i, $event)"
      @focus="($event.target as HTMLInputElement).select()"
    />
  </div>
</template>
