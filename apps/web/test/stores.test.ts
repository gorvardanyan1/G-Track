import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../src/api/client.ts';
import { budgetUsage } from '../src/lib/budget.ts';
import { readStorage, writeStorage } from '../src/lib/storage.ts';
import { formatDay, hoursLabel, money, timeOf, utcOffsetLabel } from '../src/lib/time.ts';
import { tokenFromHash } from '../src/lib/url.ts';
import { useClockStore } from '../src/stores/clock.ts';
import { useToastStore } from '../src/stores/toasts.ts';

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.useRealTimers());

describe('clock store (server time)', () => {
  const sample = (requestStart: number, roundTrip: number, serverAhead: number) => ({
    requestStart,
    responseEnd: requestStart + roundTrip,
    serverTime: requestStart + roundTrip / 2 + serverAhead,
  });

  it('measures the server offset from response samples and ignores slow ones', () => {
    const clock = useClockStore();
    expect(clock.offsetMs).toBe(0);
    for (let i = 0; i < 5; i += 1) clock.addSample(sample(1_000_000 + i * 1000, 80, 120_000));
    expect(clock.offsetMs).toBe(120_000);
    // A 30 s round trip says nothing reliable about the offset.
    clock.addSample(sample(2_000_000, 30_000, -999_999));
    expect(clock.offsetMs).toBe(120_000);
  });

  it('flags a skewed device clock only past the threshold', () => {
    const clock = useClockStore();
    clock.addSample(sample(1_000_000, 50, 60_000));
    expect(clock.skewed).toBe(false);
    const other = (setActivePinia(createPinia()), useClockStore());
    other.addSample(sample(1_000_000, 50, 3 * 60_000));
    expect(other.skewed).toBe(true);
  });

  it('elapsed time uses the server offset and ticks on second boundaries', () => {
    vi.useFakeTimers({ now: Date.parse('2026-11-01T10:00:00.100Z') });
    const clock = useClockStore();
    for (let i = 0; i < 3; i += 1) clock.addSample(sample(Date.now() - 50, 40, 10 * 60_000)); // server 10 min ahead
    const startedAt = new Date(Date.now() + 10 * 60_000 - 65_000).toISOString(); // 65 s ago on the server
    clock.start();
    expect(clock.elapsed(startedAt)).toBe(65);
    // Ticks land just after each server-second boundary: +0.905 s, +1.905 s, …
    vi.advanceTimersByTime(900);
    expect(clock.elapsed(startedAt)).toBe(65);
    vi.advanceTimersByTime(1100); // past the +1.905 s tick
    expect(clock.elapsed(startedAt)).toBe(66);
    clock.stop();
    vi.advanceTimersByTime(5000);
    expect(clock.elapsed(startedAt)).toBe(66); // stopped: no more ticks
  });
});

describe('toast store', () => {
  it('keeps at most four toasts, newest last, and dismisses them on time', () => {
    vi.useFakeTimers();
    const toasts = useToastStore();
    for (let i = 1; i <= 6; i += 1) toasts.success(`Saved ${i}`);
    expect(toasts.items.map((t) => t.title)).toEqual(['Saved 3', 'Saved 4', 'Saved 5', 'Saved 6']);
    vi.advanceTimersByTime(3500);
    expect(toasts.items).toEqual([]);
  });

  it('errors stay longer and show api messages, but never internal details', () => {
    vi.useFakeTimers();
    const toasts = useToastStore();
    toasts.error(new ApiError(409, 'TIME_ENTRY_OVERLAP', 'Overlaps another entry'), 'Not saved');
    toasts.error(new Error('TypeError: x is undefined at foo.ts:12'));
    expect(toasts.items.map((t) => [t.tone, t.title, t.message])).toEqual([
      ['error', 'Not saved', 'Overlaps another entry'],
      ['error', 'Something went wrong', 'Please try again in a moment.'],
    ]);
    vi.advanceTimersByTime(3500);
    expect(toasts.items).toHaveLength(2);
    vi.advanceTimersByTime(2500);
    expect(toasts.items).toHaveLength(0);
  });

  it('can be dismissed early', () => {
    const toasts = useToastStore();
    const id = toasts.info('Heads up');
    toasts.dismiss(id);
    expect(toasts.items).toEqual([]);
  });
});

describe('storage helpers', () => {
  it('never throw when storage is missing or blocked', () => {
    expect(readStorage('anything')).toBeNull(); // no localStorage in node
    expect(() => writeStorage('k', 'v')).not.toThrow();
    const blocked = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => undefined,
    };
    vi.stubGlobal('localStorage', blocked);
    expect(readStorage('k')).toBeNull();
    expect(() => writeStorage('k', 'v')).not.toThrow();
    vi.unstubAllGlobals();
  });

  it('round-trip values and remove on null', () => {
    const map = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
    });
    writeStorage('tempo.theme', 'dark');
    expect(readStorage('tempo.theme')).toBe('dark');
    writeStorage('tempo.theme', null);
    expect(readStorage('tempo.theme')).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('url token parsing (invite / reset links)', () => {
  it('reads the token from the fragment only when it looks like one', () => {
    const token = 'a'.repeat(43);
    expect(tokenFromHash(`#token=${token}`)).toBe(token);
    expect(tokenFromHash(`#x=1&token=${token}&y=2`)).toBe(token);
    expect(tokenFromHash('#token=short')).toBeNull();
    expect(tokenFromHash(`#token=${token}<script>`)).toBeNull();
    expect(tokenFromHash('')).toBeNull();
    expect(tokenFromHash(`#notatoken=${token}`)).toBeNull();
  });
});

describe('time formatting', () => {
  it('formats in the given zone, not the device’s', () => {
    expect(timeOf('2026-10-31T23:30:00Z', 'Europe/Berlin')).toBe('00:30');
    expect(timeOf('2026-10-31T23:30:00Z', 'America/New_York')).toBe('19:30');
    expect(timeOf('2026-10-31T23:30:00Z', 'Asia/Kathmandu')).toBe('05:15');
  });

  it('labels UTC offsets, including DST and odd zones', () => {
    expect(utcOffsetLabel('Europe/Berlin', new Date('2026-07-01T12:00:00Z'))).toBe('UTC+02:00');
    expect(utcOffsetLabel('Europe/Berlin', new Date('2026-12-01T12:00:00Z'))).toBe('UTC+01:00');
    expect(utcOffsetLabel('Asia/Kathmandu', new Date('2026-12-01T12:00:00Z'))).toBe('UTC+05:45');
    expect(utcOffsetLabel('UTC')).toBe('UTC+00:00');
  });

  it('formats calendar dates without shifting them across midnight', () => {
    // A date is a date: no device timezone may move "2026-10-31" to the 30th.
    expect(formatDay('2026-10-31', { day: 'numeric', month: 'short', year: 'numeric' })).toMatch(
      /31/,
    );
    expect(formatDay('2026-01-01', { year: 'numeric' })).toMatch(/2026/);
  });

  it('hours and money', () => {
    expect(hoursLabel(0)).toMatch(/^0 h$/);
    expect(hoursLabel(5400)).toMatch(/^1[.,]5 h$/);
    expect(money(59_500)).toMatch(/^595[.,]00$/);
    expect(money(123_456_789)).toMatch(/1.?234.?567[.,]89/);
  });

  it('budget usage at the exact boundaries', () => {
    expect(budgetUsage(0, 10).tone).toBe('ok');
    expect(budgetUsage(28_799, 10).tone).toBe('ok'); // just under 80 %
    expect(budgetUsage(28_800, 10).tone).toBe('warning'); // exactly 80 %
    expect(budgetUsage(36_000, 10).tone).toBe('warning'); // exactly 100 %
    expect(budgetUsage(36_001, 10).tone).toBe('over');
    expect(budgetUsage(100, 0).tone).toBe('none');
  });
});
