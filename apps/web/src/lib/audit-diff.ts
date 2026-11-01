export type DiffKind = 'added' | 'removed' | 'changed' | 'same';

export interface DiffRow {
  /** Dotted path, e.g. "rounding.minutes". */
  path: string;
  before: unknown;
  after: unknown;
  kind: DiffKind;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Nested objects become dotted paths; arrays and scalars are leaf values. */
function flatten(value: unknown, prefix = '', out = new Map<string, unknown>()) {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0 && prefix) out.set(prefix, value);
    for (const key of keys) flatten(value[key], prefix ? `${prefix}.${key}` : key, out);
  } else if (prefix || value !== undefined) {
    out.set(prefix || 'value', value);
  }
  return out;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Field-by-field comparison of an audit row's before/after snapshots, changed fields first.
 * Either side may be null (a creation has no "before", a deletion no "after").
 */
export function auditDiff(before: unknown, after: unknown): DiffRow[] {
  const a = before === null || before === undefined ? new Map<string, unknown>() : flatten(before);
  const b = after === null || after === undefined ? new Map<string, unknown>() : flatten(after);
  const paths = [...new Set([...a.keys(), ...b.keys()])];
  const rows = paths.map((path): DiffRow => {
    const inBefore = a.has(path);
    const inAfter = b.has(path);
    const kind: DiffKind = !inBefore
      ? 'added'
      : !inAfter
        ? 'removed'
        : same(a.get(path), b.get(path))
          ? 'same'
          : 'changed';
    return { path, before: a.get(path), after: b.get(path), kind };
  });
  const order: Record<DiffKind, number> = { changed: 0, added: 1, removed: 2, same: 3 };
  return rows.sort((x, y) => order[x.kind] - order[y.kind]);
}

/** A snapshot value for display. */
export function formatAuditValue(value: unknown): string {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value === '' ? '""' : value;
  return JSON.stringify(value);
}

/** "time_entry.updated" → "Time entry updated"; "auth.2fa.enabled" → "Auth 2fa enabled". */
export function auditActionLabel(action: string): string {
  const text = action.replace(/[._]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The groups of the action filter: each prefix ("auth.", "time_entry.") with its actions. */
export function auditActionGroups(
  actions: readonly string[],
): { prefix: string; actions: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const action of actions) {
    const prefix = `${action.split('.')[0] ?? action}.`;
    groups.set(prefix, [...(groups.get(prefix) ?? []), action]);
  }
  return [...groups].map(([prefix, list]) => ({ prefix, actions: list }));
}
