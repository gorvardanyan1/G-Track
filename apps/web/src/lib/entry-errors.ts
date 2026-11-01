import { ErrorCode } from '@tempo/shared';
import { ApiError } from '../api/client.ts';

export type EntryField = 'start' | 'end';

export interface AmbiguousTime {
  field: EntryField;
  /** The two real instants the wall-clock time could mean (ISO). */
  earlier: string;
  later: string;
}

export interface EntryErrors {
  start?: string;
  end?: string;
  /** Not tied to one field (overlap, locked period, …). */
  form?: string;
  ambiguous: AmbiguousTime[];
}

interface Issue {
  path?: unknown;
  code?: unknown;
  message?: unknown;
  earlier?: unknown;
  later?: unknown;
}

const issuesOf = (details: unknown): Issue[] =>
  Array.isArray(details) ? (details.filter((d) => d && typeof d === 'object') as Issue[]) : [];
const fieldOf = (path: unknown): EntryField => (path === 'start' ? 'start' : 'end');

/** Turns an api error from creating/updating an entry into messages the form can show. */
export function describeEntryError(error: unknown): EntryErrors {
  const out: EntryErrors = { ambiguous: [] };
  if (!(error instanceof ApiError)) {
    out.form = 'Something went wrong. Please try again.';
    return out;
  }
  switch (error.code) {
    case ErrorCode.INVALID_LOCAL_TIME:
      for (const issue of issuesOf(error.details)) {
        const field = fieldOf(issue.path);
        if (
          issue.code === 'AMBIGUOUS' &&
          typeof issue.earlier === 'string' &&
          typeof issue.later === 'string'
        ) {
          out.ambiguous.push({ field, earlier: issue.earlier, later: issue.later });
          out[field] = 'Happens twice — pick one below';
        } else {
          out[field] = typeof issue.message === 'string' ? issue.message : error.message;
        }
      }
      break;
    case ErrorCode.INVALID_TIME_RANGE:
      out.end =
        issuesOf(error.details)
          .map((issue) => (typeof issue.message === 'string' ? issue.message : ''))
          .filter(Boolean)
          .join(' ') || error.message;
      break;
    case ErrorCode.TIME_ENTRY_OVERLAP:
      out.form = `${error.message}. Entries can’t overlap — change the times or edit the other entry.`;
      break;
    case ErrorCode.PERIOD_LOCKED:
      out.form = `${error.message}.`;
      break;
    default:
      out.form = error.message;
  }
  return out;
}
