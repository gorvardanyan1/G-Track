import { z } from 'zod';

const commaSeparatedOrigins = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.url({ protocol: /^https?$/ })).min(1, 'at least one origin is required'));

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().min(1).default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
  CORS_ORIGINS: commaSeparatedOrigins,
  BODY_LIMIT: z
    .string()
    .regex(/^\d+(b|kb|mb)$/i, 'must look like 100kb or 1mb')
    .default('100kb'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  /** HMAC key for access/2FA tokens. Generate with: openssl rand -base64 48 */
  JWT_SECRET: z.string().min(32, 'must be at least 32 characters'),
  /** AES-256 key for TOTP secrets at rest, base64 of 32 bytes. openssl rand -base64 32 */
  TOTP_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32, 'must be base64 of 32 bytes'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(14),
  /** Base URL of the web app, used in invite and password-reset links. */
  WEB_APP_URL: z.url({ protocol: /^https?$/ }).default('http://localhost:5173'),
  MAIL_FROM: z.string().min(3).default('TEMPO <no-reply@tempo.test>'),
  /** Development mail transport: messages are written here as JSON files. */
  MAIL_OUTBOX_DIR: z.string().min(1).default('.outbox'),
});

/** Keys published in .env.example (and similar): never acceptable in production. */
const KNOWN_DEV_SECRETS = new Set([
  'change-me-dev-only-jwt-secret-at-least-32-chars',
  'ZGV2LW9ubHktdG90cC1rZXktY2hhbmdlLW1lLTMyYiE=',
]);
const isHttps = (url: string) => url.startsWith('https://');

/**
 * Production must not run with the example secrets, and must be served over https (the
 * refresh cookie is Secure and the web app's links point at WEB_APP_URL).
 */
const productionEnvSchema = envSchema.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;
  for (const key of ['JWT_SECRET', 'TOTP_ENCRYPTION_KEY'] as const) {
    if (KNOWN_DEV_SECRETS.has(env[key]))
      ctx.addIssue({
        code: 'custom',
        path: [key],
        message: 'is the example value; generate a new one',
      });
  }
  if (!isHttps(env.WEB_APP_URL))
    ctx.addIssue({ code: 'custom', path: ['WEB_APP_URL'], message: 'must be https in production' });
  if (!env.CORS_ORIGINS.every(isHttps))
    ctx.addIssue({
      code: 'custom',
      path: ['CORS_ORIGINS'],
      message: 'must all be https in production',
    });
});

export type Env = Readonly<z.infer<typeof envSchema>>;

export class EnvValidationError extends Error {
  constructor(issues: readonly string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/** Validates raw environment variables. Messages name the variable but never echo its value. */
export function parseEnv(source: Record<string, string | undefined>): Env {
  const result = productionEnvSchema.safeParse(source);
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  return Object.freeze(result.data);
}
