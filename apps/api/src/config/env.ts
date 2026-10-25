import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0', ''])
  .optional()
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: bool,

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  RUN_MIGRATIONS_ON_BOOT: z.enum(['true', 'false']).default('true'),
  DISABLE_JOBS: bool,

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(365).default(30),
  COOKIE_SECURE: z.enum(['auto', 'true', 'false']).default('auto'),
  COOKIE_DOMAIN: z.string().optional(),

  CLIENT_ORIGINS: csv,
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:5173'),
  PUBLIC_API_URL: z.string().url().optional(),
  SERVE_WEB_DIR: z.string().optional(),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(50).default(5),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool,

  AI_PROVIDER: z.enum(['openai_compatible', 'mock']).default('mock'),
  AI_BASE_URL: z.string().url().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().default('gpt-4.1-mini'),
  AI_REASONING_MODEL: z.string().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(60000),
  /** Legacy switch: use the AI_* endpoint for speech too (OpenAI). Prefer SPEECH_* below. */
  AI_ENABLE_AUDIO: bool,

  /**
   * Speech (transcription + text-to-speech) is configured separately from the language model so a
   * free self-hosted engine (Speaches, LocalAI) can serve voice while the LLM is OpenAI, Gemini or
   * the offline provider. Any OpenAI-compatible /v1/audio endpoint works.
   */
  SPEECH_PROVIDER: z.enum(['none', 'openai_compatible']).default('none'),
  SPEECH_BASE_URL: z.string().url().optional(),
  SPEECH_API_KEY: z.string().optional(),
  SPEECH_STT_MODEL: z.string().default('gpt-4o-mini-transcribe'),
  SPEECH_TTS_MODEL: z.string().default('gpt-4o-mini-tts'),
  SPEECH_TTS_VOICE: z.string().default('coral'),
  SPEECH_TTS_FORMAT: z.enum(['mp3', 'wav', 'opus', 'aac', 'flac']).default('mp3'),
  SPEECH_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(60000),
  /** Compatibility aliases for the previous variable names. */
  AI_STT_MODEL: z.string().optional(),
  AI_TTS_MODEL: z.string().optional(),
  AI_TTS_VOICE: z.string().optional(),

  CODE_RUNNER: z.enum(['docker', 'judge0', 'local', 'none']).default('none'),
  DOCKER_BIN: z.string().default('docker'),
  RUNNER_MAX_CONCURRENCY: z.coerce.number().int().min(1).max(32).default(4),
  JUDGE0_URL: z.string().url().optional(),
  JUDGE0_API_KEY: z.string().optional(),
  JUDGE0_API_HOST: z.string().optional(),
  JUDGE0_AUTH_TOKEN: z.string().optional(),

  EMAIL_TRANSPORT: z.enum(['smtp', 'outbox', 'console']).default('outbox'),
  EMAIL_FROM: z.string().default('HireWithSense <no-reply@hirewithsense.local>'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().default(587),
  SMTP_SECURE: bool,
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  RATE_LIMIT_MAX: z.coerce.number().int().min(10).default(300),
  RATE_LIMIT_ENABLED: z.enum(['true', 'false']).default('true'),
  SUPERADMIN_EMAILS: csv,
  DEFAULT_RETENTION_DAYS: z.coerce.number().int().min(30).default(365),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = parsed.data;
  return parsed.data;
}

export function env(): Env {
  return cached ?? loadEnv();
}

export const isProd = () => env().NODE_ENV === 'production';
export const isTest = () => env().NODE_ENV === 'test';
