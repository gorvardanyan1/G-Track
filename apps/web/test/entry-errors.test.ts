import { describe, expect, it } from 'vitest';
import { ApiError } from '../src/api/client.ts';
import { describeEntryError } from '../src/lib/entry-errors.ts';

describe('describeEntryError', () => {
  it('a time skipped by DST is an error on that field', () => {
    const error = new ApiError(400, 'INVALID_LOCAL_TIME', 'Invalid local time', [
      {
        path: 'start',
        code: 'NONEXISTENT',
        message:
          '2026-03-29 02:30 does not exist in Europe/Berlin: clocks jump forward for daylight saving time',
      },
    ]);
    expect(describeEntryError(error)).toEqual({
      ambiguous: [],
      start:
        '2026-03-29 02:30 does not exist in Europe/Berlin: clocks jump forward for daylight saving time',
    });
  });

  it('a time that happens twice offers both instants', () => {
    const error = new ApiError(400, 'INVALID_LOCAL_TIME', 'Invalid local time', [
      {
        path: 'end',
        code: 'AMBIGUOUS',
        message: '…',
        earlier: '2026-10-25T00:30:00.000Z',
        later: '2026-10-25T01:30:00.000Z',
      },
    ]);
    const result = describeEntryError(error);
    expect(result.ambiguous).toEqual([
      { field: 'end', earlier: '2026-10-25T00:30:00.000Z', later: '2026-10-25T01:30:00.000Z' },
    ]);
    expect(result.end).toBe('Happens twice — pick one below');
  });

  it('overlaps and locked periods are form-level messages; ranges go to the end field', () => {
    expect(
      describeEntryError(
        new ApiError(409, 'TIME_ENTRY_OVERLAP', 'Overlaps “Standup” (2026-10-30 09:00–11:00)'),
      ).form,
    ).toBe(
      'Overlaps “Standup” (2026-10-30 09:00–11:00). Entries can’t overlap — change the times or edit the other entry.',
    );
    expect(
      describeEntryError(
        new ApiError(409, 'PERIOD_LOCKED', 'This week’s timesheet has been submitted or approved'),
      ).form,
    ).toBe('This week’s timesheet has been submitted or approved.');
    const range = new ApiError(400, 'INVALID_TIME_RANGE', 'Invalid time range', [
      { code: 'TOO_LONG', message: 'An entry can be at most 24 hours long' },
    ]);
    expect(describeEntryError(range).end).toBe('An entry can be at most 24 hours long');
    expect(describeEntryError(new Error('boom')).form).toBe(
      'Something went wrong. Please try again.',
    );
  });
});
