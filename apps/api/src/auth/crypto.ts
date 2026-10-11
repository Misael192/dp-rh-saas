import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { authenticator } from 'otplib';
import { z } from 'zod';

export const uuid = z.string().uuid();
export const refreshSchema = z.object({ tenantId: uuid, companyId: uuid, sessionId: uuid, secret: z.string().regex(/^[a-f0-9]{64}$/) });
export function parseRefreshToken(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 256) return null;
  const parts = raw.split('.');
  if (parts.length !== 4) return null;
  const parsed = refreshSchema.safeParse({ tenantId: parts[0], companyId: parts[1], sessionId: parts[2], secret: parts[3] });
  return parsed.success ? parsed.data : null;
}
export const randomSecret = () => randomBytes(32).toString('hex');
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
export function equalHash(left: string, right: string): boolean {
  return /^[a-f0-9]{64}$/.test(left) && /^[a-f0-9]{64}$/.test(right) && timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'));
}

/** AES-256-GCM authenticates context and prevents ciphertext swapping between users. */
export function encryptSecret(value: string, key: Buffer, context: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(context));
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return ['v1', nonce.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
}
export function decryptSecret(value: string, key: Buffer, context: string) {
  const [version, nonce, tag, ciphertext, ...extra] = value.split('.');
  if (version !== 'v1' || !nonce || !tag || !ciphertext || extra.length) throw new Error('Invalid encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(nonce, 'base64url'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

export function verifyTotpStep(secret: string, code: string, lastStep: bigint | null, now = Date.now()): bigint | null {
  if (!/^\d{6}$/.test(code)) return null;
  const totp = authenticator.clone();
  totp.options = { step: 30, window: 1, epoch: now };
  const delta = totp.checkDelta(code, secret);
  if (delta === null) return null;
  const step = BigInt(Math.floor(now / 30000) + delta);
  return lastStep !== null && step <= lastStep ? null : step;
}
export function recoveryCode() { return randomBytes(16).toString('hex').match(/.{4}/g)!.join('-'); }
export function normalizeRecoveryCode(value: string) { return value.toLowerCase().replace(/-/g, ''); }
