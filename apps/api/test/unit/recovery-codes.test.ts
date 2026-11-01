import { describe, expect, it } from 'vitest';
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  normalizeRecoveryCode,
} from '../../src/lib/recovery-codes.ts';

describe('recovery codes', () => {
  it('generates 10 unique, readable codes', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^[a-km-np-z2-9]{5}-[a-km-np-z2-9]{5}$/);
  });

  it('normalizes what users type before hashing', () => {
    expect(normalizeRecoveryCode(' ABCDE-fghij ')).toBe('abcdefghij');
    expect(hashRecoveryCode('abcde-fghij')).toBe(hashRecoveryCode('ABCDE FGHIJ'));
    expect(hashRecoveryCode('abcde-fghij')).toMatch(/^[0-9a-f]{64}$/);
  });
});
