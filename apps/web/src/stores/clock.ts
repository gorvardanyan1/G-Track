import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import {
  createClockOffsetEstimator,
  elapsedSeconds,
  isClockSkewed,
  type ClockSample,
} from '@tempo/shared';

/**
 * Server time as seen from this device. Every api response carries X-Server-Time; the median
 * offset of recent samples corrects a device clock that is off, so the live timer is right.
 */
export const useClockStore = defineStore('clock', () => {
  const estimator = createClockOffsetEstimator();
  const offsetMs = ref(0);
  const samples = ref(0);
  /** Device time of the last tick; reactive, so anything reading it re-renders each second. */
  const tickMs = ref(Date.now());
  let timer: ReturnType<typeof setTimeout> | null = null;

  function addSample(sample: ClockSample): void {
    if (estimator.addSample(sample)) {
      offsetMs.value = estimator.offsetMs;
      samples.value = estimator.sampleCount;
    }
  }

  /** Ticks right after each server-time second boundary, so HH:MM:SS changes on time. */
  function schedule(): void {
    const server = Date.now() + offsetMs.value;
    timer = setTimeout(
      () => {
        tickMs.value = Date.now();
        schedule();
      },
      1000 - (((server % 1000) + 1000) % 1000) + 5,
    );
  }

  function start(): void {
    if (timer === null) schedule();
  }

  function stop(): void {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  /** Server "now" in ms (reactive to the tick). */
  const serverNowMs = computed(() => tickMs.value + offsetMs.value);
  const skewed = computed(() => samples.value > 0 && isClockSkewed(offsetMs.value));

  return {
    offsetMs,
    serverNowMs,
    skewed,
    addSample,
    start,
    stop,
    /** Whole seconds since `startedAt` by the server's clock (reactive to the tick). */
    elapsed: (startedAt: string | Date) =>
      elapsedSeconds(new Date(startedAt), tickMs.value, offsetMs.value),
  };
});
