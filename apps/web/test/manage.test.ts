import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { budgetUsage } from '../src/lib/budget.ts';
import { liveExtraSeconds } from '../src/lib/live-usage.ts';
import { resolvePeriod, spanDays } from '../src/lib/report-period.ts';
import { useActivityStore } from '../src/stores/activity.ts';

beforeEach(() => setActivePinia(createPinia()));

const person = (id: string, name: string) => ({
  id: `0190e5b2-0000-7000-8000-00000000000${id}`,
  name,
});
const running = (startedAt: string, projectId = '0190e5b2-0000-7000-8000-0000000000a1') => ({
  id: `0190e5b2-0000-7000-8000-${startedAt.replace(/\D/g, '').slice(0, 12)}`,
  project: { id: projectId, name: 'Website', color: '#5B5BF7' },
  task: null,
  description: '',
  isBillable: true,
  startedAt,
});
const serverTime = '2026-11-01T10:00:00.000Z';

describe('activity store (“working now”)', () => {
  it('takes the snapshot, then applies starts, switches and stops', () => {
    const activity = useActivityStore();
    const lena = person('1', 'Lena');
    const omar = person('2', 'Omar');
    activity.applySnapshot({
      items: [{ user: lena, entry: running('2026-11-01T09:00:00Z') }],
      serverTime,
    });
    expect(activity.received).toBe(true);
    activity.applyUpdate({ user: omar, running: running('2026-11-01T08:00:00Z'), serverTime });
    // Longest-running first.
    expect(activity.items.map((i) => i.user.name)).toEqual(['Omar', 'Lena']);

    const other = '0190e5b2-0000-7000-8000-0000000000b2';
    activity.applyUpdate({
      user: lena,
      running: running('2026-11-01T09:30:00Z', other),
      serverTime,
    });
    expect(activity.onProject(other).map((i) => i.user.name)).toEqual(['Lena']);
    activity.applyUpdate({ user: omar, running: null, serverTime });
    expect(activity.items.map((i) => i.user.name)).toEqual(['Lena']);
  });

  it('a new snapshot (reconnect) replaces everything; reset clears it', () => {
    const activity = useActivityStore();
    activity.applyUpdate({
      user: person('1', 'Lena'),
      running: running('2026-11-01T09:00:00Z'),
      serverTime,
    });
    activity.applySnapshot({ items: [], serverTime });
    expect(activity.items).toEqual([]);
    activity.reset();
    expect(activity.received).toBe(false);
  });
});

describe('budget usage', () => {
  it('is ok below 80 %, a warning from 80 %, over past 100 %', () => {
    expect(budgetUsage(36_000, 100)).toMatchObject({
      percent: 10,
      tone: 'ok',
      remainingSeconds: 324_000,
    });
    expect(budgetUsage(288_000, 100)).toMatchObject({ percent: 80, tone: 'warning' });
    expect(budgetUsage(360_000, 100)).toMatchObject({
      percent: 100,
      tone: 'warning',
      remainingSeconds: 0,
    });
    expect(budgetUsage(363_600, 100)).toMatchObject({
      percent: 101,
      tone: 'over',
      remainingSeconds: -3600,
    });
  });

  it('has no ratio without a budget', () => {
    expect(budgetUsage(5000, null)).toEqual({
      ratio: null,
      percent: null,
      tone: 'none',
      remainingSeconds: null,
    });
  });
});

describe('live usage between reloads', () => {
  const fetched = Date.parse('2026-11-01T10:00:00Z');
  const now = fetched + 90_000;
  it('adds time since the fetch, or since a later start', () => {
    expect(liveExtraSeconds(['2026-11-01T08:00:00Z'], fetched, now)).toBe(90);
    expect(liveExtraSeconds(['2026-11-01T10:01:00Z'], fetched, now)).toBe(30);
    expect(liveExtraSeconds(['2026-11-01T08:00:00Z', '2026-11-01T10:01:00Z'], fetched, now)).toBe(
      120,
    );
    expect(liveExtraSeconds(['2026-11-01T10:05:00Z'], fetched, now)).toBe(0);
    expect(liveExtraSeconds([], fetched, now)).toBe(0);
  });
});

describe('report periods', () => {
  const weekOf = (date: string) =>
    Promise.resolve({ from: `week-of-${date}`, to: `week-of-${date}` });
  it('asks the api for weeks and uses calendar months', async () => {
    await expect(resolvePeriod('week', '2026-11-01', weekOf)).resolves.toEqual({
      from: 'week-of-2026-11-01',
      to: 'week-of-2026-11-01',
    });
    await expect(resolvePeriod('last-week', '2026-11-01', weekOf)).resolves.toMatchObject({
      from: 'week-of-2026-10-25',
    });
    await expect(resolvePeriod('month', '2026-02-14', weekOf)).resolves.toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    await expect(resolvePeriod('last-month', '2026-03-31', weekOf)).resolves.toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
    });
    await expect(resolvePeriod('last-month', '2026-01-05', weekOf)).resolves.toEqual({
      from: '2025-12-01',
      to: '2025-12-31',
    });
  });

  it('counts inclusive days', () => {
    expect(spanDays({ from: '2026-10-01', to: '2026-10-31' })).toBe(31);
    expect(spanDays({ from: '2026-11-01', to: '2026-11-01' })).toBe(1);
  });
});
