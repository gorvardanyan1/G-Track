// Local development helper for two-factor authentication. Usage (from apps/api):
//   npm run user:2fa -- --email superadmin@tempo.test --set [--secret JBSWY3DPEHPK3PXP...]
//       gives the user a fixed test key (random if --secret is left out) and prints it
//   npm run user:2fa -- --email superadmin@tempo.test
//       prints the current 6-digit code, so no authenticator app is needed
// Codes work once per 30 seconds (replay protection), exactly as in the app.
import { parseArgs } from 'node:util';
import { createPrismaClient } from '../../src/db/prisma.ts';
import { createSecretBox } from '../../src/lib/secret-box.ts';
import { generateTotp, generateTotpSecret, base32Decode } from '../../src/lib/totp.ts';

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

if (process.env['NODE_ENV'] === 'production') fail('Refusing to run with NODE_ENV=production.');
const databaseUrl =
  process.env['DATABASE_URL'] ?? fail('DATABASE_URL is not set (see apps/api/.env)');
const keyBase64 =
  process.env['TOTP_ENCRYPTION_KEY'] ?? fail('TOTP_ENCRYPTION_KEY is not set (see apps/api/.env)');

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    set: { type: 'boolean', default: false },
    secret: { type: 'string' },
  },
});
if (!values.email) fail('--email is required');

const box = createSecretBox(keyBase64);
const prisma = createPrismaClient(databaseUrl);
try {
  const user = await prisma.user.findUnique({
    where: { email: values.email!.trim().toLowerCase() },
  });
  if (!user) fail(`No user with email ${values.email}`);

  if (values.set) {
    const secret = (values.secret ?? generateTotpSecret()).replace(/[\s-]/g, '').toUpperCase();
    // Must be valid base32 of a usable length, or the app could never verify codes against it.
    if (!/^[A-Z2-7]{16,64}$/.test(secret) || base32Decode(secret).length < 10)
      fail('--secret must be base32 (letters A–Z and digits 2–7), at least 16 characters');
    await prisma.user.update({
      where: { id: user!.id },
      data: {
        totpSecretEncrypted: box.encrypt(secret, user!.id),
        totpEnabledAt: new Date(),
        totpLastUsedStep: null,
      },
    });
    process.stdout.write(
      `2FA key for ${user!.email}:\n  ${secret}\n` +
        'Add it to an authenticator app, or print the current code any time with:\n' +
        `  npm run user:2fa -- --email ${user!.email}\n`,
    );
  } else {
    if (!user!.totpSecretEncrypted || !user!.totpEnabledAt)
      fail(`${user!.email} has no 2FA yet. Run it with --set first.`);
    const secret = box.decrypt(user!.totpSecretEncrypted!, user!.id);
    const now = new Date();
    const left = 30 - (Math.floor(now.getTime() / 1000) % 30);
    process.stdout.write(`${generateTotp(secret, now)}  (valid for about ${left} more seconds)\n`);
  }
} finally {
  await prisma.$disconnect();
}
