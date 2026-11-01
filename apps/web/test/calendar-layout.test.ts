import { describe, expect, it } from 'vitest';
import { dragRange, layoutWeek, minuteToTime, snapMinute } from '../src/lib/calendar-layout.ts';
import { entry } from './fixtures.ts';

const BERLIN = 'Europe/Berlin';
const WEEK = [
  '2026-10-19',
  '2026-10-20',
  '2026-10-21',
  '2026-10-22',
  '2026-10-23',
  '2026-10-24',
  '2026-10-25',
];
const blocks = (map: ReturnType<typeof layoutWeek>, date: string) =>
  (map.get(date) ?? []).map((b) => [
    b.startMinute,
    b.endMinute,
    b.lane,
    b.lanes,
    b.continuesBefore,
    b.continuesAfter,
  ]);

describe('layoutWeek', () => {
  it('positions by local wall-clock time and splits at midnight', () => {
    const late = entry('2026-10-21T20:00:00Z', '2026-10-22T00:30:00Z'); // 22:00–02:30
    const map = layoutWeek([late], WEEK, BERLIN, Date.now());
    expect(blocks(map, '2026-10-21')).toEqual([[22 * 60, 1440, 0, 1, false, true]]);
    expect(blocks(map, '2026-10-22')).toEqual([[0, 150, 0, 1, true, false]]);
  });

  it('keeps 09:00 at the 9 o’clock line on the day clocks go back', () => {
    const nine = entry('2026-10-25T08:00:00Z', '2026-10-25T09:00:00Z'); // 09:00–10:00 CET
    expect(blocks(layoutWeek([nine], WEEK, BERLIN, Date.now()), '2026-10-25')).toEqual([
      [540, 600, 0, 1, false, false],
    ]);
  });

  it('puts wall-clock overlaps (the repeated DST hour) side by side', () => {
    const first = entry('2026-10-25T00:10:00Z', '2026-10-25T00:50:00Z'); // 02:10–02:50 CEST
    const second = entry('2026-10-25T01:10:00Z', '2026-10-25T01:50:00Z'); // 02:10–02:50 CET
    const lanes = blocks(layoutWeek([first, second], WEEK, BERLIN, Date.now()), '2026-10-25').map(
      (b) => [b[2], b[3]],
    );
    expect(lanes).toEqual([
      [0, 2],
      [1, 2],
    ]);
  });

  it('draws a running entry up to now', () => {
    const running = entry('2026-10-20T08:00:00Z', null); // 10:00 CEST
    const map = layoutWeek([running], WEEK, BERLIN, Date.parse('2026-10-20T09:30:00Z'));
    expect(blocks(map, '2026-10-20')).toEqual([[600, 690, 0, 1, false, false]]);
  });
});

describe('drag to create', () => {
  it('snaps to 15 minutes, orders the ends and keeps at least one step', () => {
    expect(snapMinute(547)).toBe(540);
    expect(snapMinute(1500)).toBe(1440);
    expect(dragRange(640, 545)).toMatchObject({ start: '09:00', end: '10:45' });
    expect(dragRange(600, 603)).toMatchObject({ start: '10:00', end: '10:15' });
    expect(dragRange(1430, 1440)).toMatchObject({ start: '23:45', end: '00:00', endMinute: 1440 });
    expect(minuteToTime(75)).toBe('01:15');
  });
});
