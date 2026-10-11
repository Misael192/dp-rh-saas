import { createHmac, timingSafeEqual } from 'node:crypto';

export interface DownloadTokenPayload {
  tenantId: string;
  companyId: string;
  fileId: string;
  userId: string;
  /** Unix epoch seconds after which the URL is no longer accepted. */
  exp: number;
}

const TOKEN_VERSION = 'v1';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function secretKey(secret: string): Buffer {
  if (Buffer.byteLength(secret) < 32) throw new Error('DOWNLOAD_TOKEN_SECRET must contain at least 32 bytes');
  return Buffer.from(secret);
}

/**
 * Stateless HMAC-signed download capability. The token binds the file to the
 * requesting user and company scope plus an expiry; it never exposes provider
 * credentials or the raw object key. Format: v1.<base64url payload>.<hex hmac>.
 */
export function signDownloadToken(payload: DownloadTokenPayload, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secretKey(secret)).update(`${TOKEN_VERSION}.${body}`).digest('hex');
  return `${TOKEN_VERSION}.${body}.${mac}`;
}

export function verifyDownloadToken(token: string, secret: string): DownloadTokenPayload | null {
  if (typeof token !== 'string' || token.length > 4096) return null;
  const [version, body, mac, ...extra] = token.split('.');
  if (version !== TOKEN_VERSION || !body || !mac || extra.length) return null;
  if (!/^[a-f0-9]{64}$/.test(mac)) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const expected = createHmac('sha256', secretKey(secret)).update(`${TOKEN_VERSION}.${body}`).digest();
  const provided = Buffer.from(mac, 'hex');
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return null;
  const candidate = payload as Partial<DownloadTokenPayload>;
  if (
    typeof candidate.tenantId !== 'string' || !UUID_PATTERN.test(candidate.tenantId) ||
    typeof candidate.companyId !== 'string' || !UUID_PATTERN.test(candidate.companyId) ||
    typeof candidate.fileId !== 'string' || !UUID_PATTERN.test(candidate.fileId) ||
    typeof candidate.userId !== 'string' || !UUID_PATTERN.test(candidate.userId) ||
    typeof candidate.exp !== 'number' || !Number.isInteger(candidate.exp)
  ) return null;
  if (candidate.exp * 1000 <= Date.now()) return null;
  return { tenantId: candidate.tenantId, companyId: candidate.companyId, fileId: candidate.fileId, userId: candidate.userId, exp: candidate.exp };
}
