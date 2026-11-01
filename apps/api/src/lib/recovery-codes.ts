import { randomBytes } from 'node:crypto';
import { sha256Hex } from './tokens.ts';

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // 32 symbols, no 0/o/1/l confusion
export const RECOVERY_CODE_COUNT = 10;

/** 10 random symbols (50 bits), shown as "xxxxx-xxxxx". 256 % 32 === 0, so no modulo bias. */
export function generateRecoveryCode(): string {
  const chars = [...randomBytes(10)].map((byte) => ALPHABET[byte % 32]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, generateRecoveryCode);
}

/** Users may type codes with spaces, dashes or capitals. */
export function normalizeRecoveryCode(input: string): string {
  return input.toLowerCase().replace(/[\s-]/g, '');
}

export function hashRecoveryCode(input: string): string {
  return sha256Hex(normalizeRecoveryCode(input));
}
