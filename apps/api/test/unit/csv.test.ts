import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../../src/lib/csv.ts';

describe('csv', () => {
  it('quotes only when needed and doubles quotes', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(1.5)).toBe('1.5');
    expect(csvCell(true)).toBe('true');
  });

  it.each(['=1+1', '+1', '-1', '@SUM(A1)', '\tx', '\rx'])(
    'neutralizes formula-looking text %j',
    (value) => {
      expect(csvCell(value).replace(/^"/, '')).toMatch(/^'/);
    },
  );

  it('starts with a BOM and uses CRLF', () => {
    expect(
      toCsv([
        ['a', 'b'],
        ['1', '2'],
      ]),
    ).toBe('\uFEFFa,b\r\n1,2\r\n');
  });
});
