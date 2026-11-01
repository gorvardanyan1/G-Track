/**
 * A small seeded PRNG (mulberry32) for property tests: random but reproducible, so a failure
 * always comes back with the same inputs. Pass another seed to explore other cases.
 */
export function createRandom(seed = 20261101) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1));
  return {
    seed,
    next,
    int,
    pick: <T>(items: readonly T[]): T => items[int(0, items.length - 1)] as T,
    bool: (p = 0.5) => next() < p,
  };
}

/** Zones chosen for their edge cases. */
export const TRICKY_ZONES = [
  'UTC',
  'Europe/Berlin',
  'America/New_York',
  'Asia/Yerevan',
  'Australia/Sydney',
  'Australia/Lord_Howe', // 30-minute DST shift
  'Asia/Kathmandu', // +05:45
  'Pacific/Chatham', // +12:45 / +13:45
  'America/Havana', // DST switches at midnight
  'America/Santiago', // southern hemisphere, midnight switches
  'Pacific/Apia',
  'America/St_Johns', // -03:30 / -02:30
] as const;
