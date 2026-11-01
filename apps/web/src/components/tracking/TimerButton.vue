<script setup lang="ts">
defineProps<{ running: boolean; busy?: boolean }>();
</script>

<template>
  <button
    type="button"
    class="timer-btn relative inline-flex size-10 shrink-0 sm:size-11 items-center justify-center rounded-full text-white disabled:opacity-60"
    :class="running ? 'is-running' : ''"
    :aria-label="running ? 'Stop timer (S)' : 'Start timer (S)'"
    :aria-pressed="running"
    :disabled="busy"
  >
    <span v-if="running" class="ring" aria-hidden="true" />
    <span v-if="running" class="ring ring-late" aria-hidden="true" />
    <span class="glyph" aria-hidden="true" />
  </button>
</template>

<style scoped>
.timer-btn {
  background: var(--accent);
  box-shadow:
    0 6px 16px -6px rgb(91 91 247 / 0.7),
    inset 0 1px 0 rgb(255 255 255 / 0.2);
  transition:
    background-color 260ms ease,
    box-shadow 260ms ease,
    transform 150ms ease;
}
.timer-btn:hover {
  transform: scale(1.04);
}
.timer-btn:active {
  transform: scale(0.96);
}
.timer-btn.is-running {
  background: var(--running);
  box-shadow:
    0 6px 18px -6px rgb(22 163 74 / 0.75),
    inset 0 1px 0 rgb(255 255 255 / 0.2);
}
/* The play triangle morphs into a stop square: same four points, so clip-path animates. */
.glyph {
  width: 15px;
  height: 15px;
  margin-left: 3px;
  background: currentColor;
  clip-path: polygon(10% 4%, 10% 96%, 96% 50%, 96% 50%);
  transition:
    clip-path 280ms cubic-bezier(0.3, 1.3, 0.5, 1),
    margin 280ms ease,
    border-radius 280ms ease;
}
.is-running .glyph {
  margin-left: 0;
  border-radius: 2px;
  clip-path: polygon(8% 8%, 8% 92%, 92% 92%, 92% 8%);
}
.ring {
  position: absolute;
  inset: 0;
  border-radius: 9999px;
  border: 2px solid var(--running);
  animation: pulse-ring 2s cubic-bezier(0.2, 0.6, 0.3, 1) infinite;
  pointer-events: none;
}
.ring-late {
  animation-delay: 1s;
}
@media (prefers-reduced-motion: reduce) {
  .ring {
    display: none;
  }
}
</style>
