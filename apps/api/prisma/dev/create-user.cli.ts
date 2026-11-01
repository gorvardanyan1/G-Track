// Creates one account for local development. Usage (from apps/api):
//   npm run user:create -- --email ana@tempo.test --name "Ana" --role WORKER \
//     --password "a long passphrase" [--timezone Europe/Berlin] [--project "Fleet Dashboard"]... \
//     [--rate 80] [--allow-weak-password]
import { parseArgs } from 'node:util';
import { USER_ROLES, type UserRole } from '@tempo/shared';
import { createPrismaClient } from '../../src/db/prisma.ts';
import { createLocalUser, CreateUserError } from './create-user.ts';

const fail = (message: string): never => {
  process.stderr.write(`${message}\n`);
  process.exit(1);
};

if (process.env['NODE_ENV'] === 'production')
  fail('Refusing to run with NODE_ENV=production: people join through invitations there.');
const databaseUrl =
  process.env['DATABASE_URL'] ?? fail('DATABASE_URL is not set (see apps/api/.env)');

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    role: { type: 'string', default: 'WORKER' },
    password: { type: 'string' },
    timezone: { type: 'string' },
    project: { type: 'string', multiple: true },
    rate: { type: 'string' },
    'allow-weak-password': { type: 'boolean', default: false },
  },
});
const role = values.role.toUpperCase();
if (!(USER_ROLES as readonly string[]).includes(role))
  fail(`--role must be one of ${USER_ROLES.join(', ')}`);
if (!values.email || !values.name || !values.password)
  fail('--email, --name and --password are required');
const rate = values.rate === undefined ? null : Number(values.rate);
if (rate !== null && !(rate >= 0)) fail('--rate must be a positive number');

const prisma = createPrismaClient(databaseUrl);
try {
  const { user, projects, weakPassword } = await createLocalUser(prisma, {
    email: values.email!,
    name: values.name!,
    role: role as UserRole,
    password: values.password!,
    ...(values.timezone && { timezone: values.timezone }),
    projects: values.project ?? [],
    hourlyRate: rate,
    allowWeakPassword: values['allow-weak-password'],
  });
  process.stdout.write(
    `Created ${user.role} ${user.email} (${user.name}, ${user.timezone})` +
      (projects.length ? ` on ${projects.join(', ')}` : '') +
      (weakPassword ? ' — weak password allowed for local testing' : '') +
      '\n',
  );
} catch (err) {
  if (err instanceof CreateUserError) fail(err.message);
  throw err;
} finally {
  await prisma.$disconnect();
}
