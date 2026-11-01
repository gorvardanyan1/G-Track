import { describe, expect, it } from 'vitest';
import { checkPasswordPolicy } from '../src/index.ts';

describe('checkPasswordPolicy', () => {
  it('accepts a long passphrase', () => {
    expect(checkPasswordPolicy('correct horse battery staple')).toEqual([]);
    expect(checkPasswordPolicy('Zx9!vT2#qL7m')).toEqual([]);
  });

  it('enforces length, counting characters not bytes', () => {
    expect(checkPasswordPolicy('short1!A')).toContain('TOO_SHORT');
    expect(checkPasswordPolicy('ünïcödé-pässw')).not.toContain('TOO_SHORT');
    expect(checkPasswordPolicy('a1b2c3d4'.repeat(17))).toContain('TOO_LONG');
  });

  it.each(['Password1234!', 'passwordpassword', '123456789012', 'qwertyuiop12', '!!Welcome2026'])(
    'rejects the common password %j',
    (password) => expect(checkPasswordPolicy(password)).toContain('TOO_COMMON'),
  );

  it('rejects passwords containing the email local part or name', () => {
    expect(
      checkPasswordPolicy('lena.fischer-2026!', { email: 'lena.fischer@tempo.test' }),
    ).toContain('CONTAINS_PERSONAL_INFO');
    expect(checkPasswordPolicy('I am Fischer, ok?', { name: 'Lena Fischer' })).toContain(
      'CONTAINS_PERSONAL_INFO',
    );
    expect(checkPasswordPolicy('correct horse battery', { name: 'Al' })).toEqual([]);
  });

  it('rejects repeated characters', () => {
    expect(checkPasswordPolicy('aaaaaaaaaaaa')).toContain('REPEATED_CHARACTERS');
    expect(checkPasswordPolicy('abababababab')).toContain('REPEATED_CHARACTERS');
  });
});
