import type { TimeEntryResponse } from '@tempo/shared';

let n = 0;
/** A time entry response with sensible defaults. */
export function entry(
  startedAt: string,
  endedAt: string | null,
  extra: Partial<TimeEntryResponse> = {},
): TimeEntryResponse {
  n += 1;
  const id = `0190e5b2-0000-7000-8000-${String(n).padStart(12, '0')}`;
  return {
    id,
    userId: '0190e5b2-0000-7000-8000-aaaaaaaaaaaa',
    projectId: '0190e5b2-0000-7000-8000-bbbbbbbbbbbb',
    taskId: null,
    description: `Entry ${n}`,
    startedAt,
    endedAt,
    durationSeconds: endedAt ? (Date.parse(endedAt) - Date.parse(startedAt)) / 1000 : null,
    isBillable: true,
    source: endedAt ? 'MANUAL' : 'TIMER',
    project: { id: '0190e5b2-0000-7000-8000-bbbbbbbbbbbb', name: 'Fleet', color: '#5B5BF7' },
    task: null,
    editable: true,
    ...extra,
  };
}
