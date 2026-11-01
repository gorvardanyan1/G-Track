import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from '../../src/lib/csv.ts';
import { createJwtService } from '../../src/lib/jwt.ts';

/** Seeded PRNG (mulberry32): random but reproducible inputs. */
function random(seed = 20261101) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next, int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)) };
}

/** Minimal RFC 4180 parser, to check that what we write reads back unchanged. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\r' && text[i + 1] === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      i += 1;
    } else {
      cell += c;
    }
  }
  return rows;
}

const ALPHABET = [
  'a',
  'Z',
  '0',
  ' ',
  ',',
  '"',
  '\n',
  '\r',
  '\t',
  '=',
  '+',
  '-',
  '@',
  'é',
  '€',
  '😀',
  ';',
  "'",
];

describe('CSV export (fuzz)', () => {
  it('any text survives a round trip, and nothing can start a formula', () => {
    const r = random();
    for (let n = 0; n < 2000; n += 1) {
      const cells = Array.from({ length: r.int(1, 6) }, () =>
        Array.from({ length: r.int(0, 12) }, () => ALPHABET[r.int(0, ALPHABET.length - 1)]).join(
          '',
        ),
      );
      const csv = toCsv([cells]);
      expect(csv.startsWith('﻿')).toBe(true);
      const [parsed] = parseCsv(csv.slice(1));
      expect(parsed).toHaveLength(cells.length);
      parsed!.forEach((value, i) => {
        const original = cells[i]!;
        // Formula starters are neutralized with a leading apostrophe, everything else unchanged.
        expect(value).toBe(/^[=+\-@\t\r]/.test(original) ? `'${original}` : original);
        expect(/^[=+\-@\t\r]/.test(value)).toBe(false);
      });
    }
  });

  it('numbers, booleans and nulls are written plainly', () => {
    expect(csvCell(12.5)).toBe('12.5');
    expect(csvCell(-3)).toBe('-3'); // numbers are data, not formulas
    expect(csvCell(true)).toBe('true');
    expect(csvCell(null)).toBe('');
  });
});

describe('JWT verification (fuzz)', () => {
  const now = () => new Date('2026-11-01T10:00:00Z');
  const jwt = createJwtService('fuzz-secret-that-is-long-enough-1234567890', now);
  const token = jwt.sign(
    {
      sub: '0190e5b2-0000-7000-8000-000000000001',
      typ: 'access',
      sid: '0190e5b2-0000-7000-8000-000000000002',
    },
    900,
  ).token;
  const B64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  it('accepts the untouched token', () => {
    expect(jwt.verify(token, 'access').sub).toBe('0190e5b2-0000-7000-8000-000000000001');
  });

  it('rejects every single-character change anywhere in the token', () => {
    const r = random();
    for (let n = 0; n < 3000; n += 1) {
      const i = r.int(0, token.length - 1);
      if (token[i] === '.') continue;
      let replacement = B64URL[r.int(0, B64URL.length - 1)]!;
      if (replacement === token[i]) replacement = replacement === 'A' ? 'B' : 'A';
      const tampered = token.slice(0, i) + replacement + token.slice(i + 1);
      // A changed last character can decode to the same bytes (unused base64 bits); then it's
      // the same token, which is fine. Anything that changes the bytes must be refused.
      const sameBytes = tampered
        .split('.')
        .every((part, k) =>
          Buffer.from(part, 'base64url').equals(Buffer.from(token.split('.')[k]!, 'base64url')),
        );
      if (sameBytes) continue;
      expect(() => jwt.verify(tampered, 'access'), tampered).toThrow();
    }
  });

  it('rejects truncated, extended and reshuffled tokens', () => {
    const [h, p, s] = token.split('.') as [string, string, string];
    for (const bad of [
      '',
      h,
      `${h}.${p}`,
      `${h}.${p}.`,
      `${h}.${p}.${s}.extra`,
      `${p}.${h}.${s}`,
      `${h}.${s}.${p}`,
      `${h}.${p}.${s.slice(0, -2)}`,
      `${h}..${s}`,
      token.toUpperCase(),
    ]) {
      expect(() => jwt.verify(bad, 'access'), bad).toThrow();
    }
  });

  it('rejects random garbage without crashing', () => {
    const r = random(7);
    for (let n = 0; n < 1000; n += 1) {
      const garbage = Array.from({ length: r.int(0, 300) }, () =>
        String.fromCharCode(r.int(32, 126)),
      ).join('');
      expect(() => jwt.verify(garbage, 'access')).toThrow();
    }
  });
});
