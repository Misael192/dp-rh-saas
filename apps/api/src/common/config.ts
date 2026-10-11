import { Injectable } from '@nestjs/common';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  JWT_SECRET: z.string().refine(value => Buffer.byteLength(value) >= 32, 'Must contain at least 32 bytes'),
  DATA_ENCRYPTION_KEY: z.string().refine(value => /^[A-Za-z0-9+/]{43}=$/.test(value) && Buffer.from(value, 'base64').length === 32, 'Must be a base64 32-byte key'),
  WEB_ORIGIN: z.string().url().refine(value => new URL(value).origin === value, 'Must be an origin without a path'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  HOST: z.string().default('127.0.0.1'),
  REDIS_PREFIX: z.string().regex(/^[A-Za-z0-9:_-]{1,80}$/).default('peopleflow'),
  RATE_LIMIT_MAX: z.coerce.number().int().min(1).max(1000).default(30),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().min(1).max(1000).default(10),
  API_PROXY_SECRET: z.string().refine(value => Buffer.byteLength(value) >= 32, 'Must contain at least 32 bytes').optional(),
});

@Injectable()
export class AppConfig {
  readonly values: z.infer<typeof envSchema>;
  constructor() {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      // Values are deliberately omitted from startup errors.
      throw new Error(`Invalid configuration: ${parsed.error.issues.map(issue => issue.path.join('.')).join(', ')}`);
    }
    this.values = parsed.data;
    if (this.values.NODE_ENV === 'production' && !this.values.WEB_ORIGIN.startsWith('https://')) {
      throw new Error('WEB_ORIGIN requires HTTPS in production');
    }
    if (this.values.NODE_ENV === 'production' && !this.values.API_PROXY_SECRET) throw new Error('API_PROXY_SECRET is required in production');
  }
  get secureCookies() { return this.values.NODE_ENV === 'production'; }
}
