import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { useClockStore } from '../src/stores/clock.ts';
import { useEntriesStore } from '../src/stores/entries.ts';
import { useTimerStore } from '../src/stores/timer.ts';
import { entry } from './fixtures.ts';

beforeEach(() => setActivePinia(createPinia()));

describe('timer store (tabs stay in sync through the same events)', () => {
  it('a running entry from another tab becomes the timer and fills the draft', () => {
    const timer = useTimerStore();
    const running = entry('2026-10-31T10:00:00Z', null, { description: 'Design review' });
    timer.applySaved(running);
    expect(timer.running?.id).toBe(running.id);
    expect(timer.draft).toMatchObject({
      description: 'Design review',
      projectId: running.projectId,
    });
    expect(useEntriesStore().byId[running.id]).toEqual(running);
  });

  it('the stopped version of the running entry clears it; other entries don’t', () => {
    const timer = useTimerStore();
    const running = entry('2026-10-31T10:00:00Z', null);
    timer.applySaved(running);
    timer.applySaved(entry('2026-10-30T10:00:00Z', '2026-10-30T11:00:00Z'));
    expect(timer.running?.id).toBe(running.id);
    timer.applySaved({ ...running, endedAt: '2026-10-31T11:00:00Z', durationSeconds: 3600 });
    expect(timer.running).toBeNull();
    expect(timer.draft.projectId).toBeNull();
  });

  it('a deleted running entry clears the timer', () => {
    const timer = useTimerStore();
    const running = entry('2026-10-31T10:00:00Z', null);
    timer.applySaved(running);
    timer.applyDeleted(running.id);
    expect(timer.running).toBeNull();
    expect(useEntriesStore().byId[running.id]).toBeUndefined();
  });

  it('elapsed time follows the server clock offset, not the device clock', () => {
    const clock = useClockStore();
    const timer = useTimerStore();
    const deviceNow = Date.now();
    // The device is 5 minutes behind the server.
    clock.addSample({
      requestStart: deviceNow - 20,
      responseEnd: deviceNow,
      serverTime: deviceNow - 10 + 300_000,
    });
    timer.applySaved(entry(new Date(deviceNow + 300_000 - 60_000).toISOString(), null));
    expect(timer.elapsed).toBeGreaterThanOrEqual(59);
    expect(timer.elapsed).toBeLessThanOrEqual(61);
    expect(clock.skewed).toBe(true);
  });
});
