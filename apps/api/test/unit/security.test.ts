import { describe, expect, it, vi } from 'vitest';
import { JwtService } from '@nestjs/jwt';
import { authenticator } from 'otplib';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret, equalHash, hashToken, parseRefreshToken, verifyTotpStep } from '../../src/auth/crypto';
import { validCsrf } from '../../src/auth/csrf.guard';
import { loginSchema } from '../../src/auth/auth.schemas';
import { ZodPipe } from '../../src/common/zod.pipe';
import { AuthService } from '../../src/auth/auth.service';
import { AppConfig } from '../../src/common/config';
import { DatabaseService } from '../../src/database/database.service';
import { trustedClientIp } from '../../src/common/rate-limit.guard';

describe('cryptographic boundaries', () => {
  it('authenticates encryption ciphertext and owning company context', () => {
    const key = randomBytes(32);
    const ciphertext = encryptSecret('TOTP-SECRET', key, 'company-a:user-a');
    expect(ciphertext).not.toContain('TOTP-SECRET');
    expect(decryptSecret(ciphertext, key, 'company-a:user-a')).toBe('TOTP-SECRET');
    expect(() => decryptSecret(ciphertext, key, 'company-b:user-a')).toThrow();
    expect(() => decryptSecret(ciphertext, randomBytes(32), 'company-a:user-a')).toThrow();
    const parts = ciphertext.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key, 'company-a:user-a')).toThrow();
  });
  it('rejects TOTP replay and accepts an adjacent step exactly once', () => {
    const secret = authenticator.generateSecret();
    const now = 1800000030000;
    const generator = authenticator.clone();
    generator.options = { epoch: now };
    const code = generator.generate(secret);
    const step = verifyTotpStep(secret, code, null, now);
    expect(step).toBe(BigInt(Math.floor(now / 30000)));
    expect(verifyTotpStep(secret, code, step, now)).toBeNull();
    expect(verifyTotpStep(secret, code, step! + 1n, now)).toBeNull();
    generator.options = { epoch: now + 30000 };
    expect(verifyTotpStep(secret, generator.generate(secret), step, now)).toBe(step! + 1n);
    expect(verifyTotpStep(secret, 'invalid', null, now)).toBeNull();
  });
  it('parses scoped refresh tokens and rejects malformed scopes before database work', () => {
    const valid = `e32e6b70-f2ea-4a2e-80b3-499263951919.8184be17-cdd4-4c47-95a9-9697d1397d7e.0ebd33a7-72bc-4361-84cc-cd6edb1bd176.${'a'.repeat(64)}`;
    expect(parseRefreshToken(valid)?.secret).toHaveLength(64);
    expect(parseRefreshToken(valid + '.extra')).toBeNull();
    expect(parseRefreshToken(valid.replace('e32e6b70-f2ea-4a2e-80b3-499263951919', 'bad-scope'))).toBeNull();
    expect(equalHash(hashToken('a'), hashToken('a'))).toBe(true);
    expect(equalHash(hashToken('a'), hashToken('b'))).toBe(false);
    expect(equalHash('', '')).toBe(false);
  });
});

describe('HTTP input and CSRF boundaries', () => {
  it('ignores spoofed proxy and forwarded IP headers without the BFF secret', () => {
    const secret = 'proxy-secret-'.repeat(4);
    const request = { headers: { 'x-peopleflow-client-ip': '203.0.113.5', 'x-peopleflow-proxy-key': 'wrong', 'x-forwarded-for': '203.0.113.8' }, ip: '127.0.0.1', socket: { remoteAddress: '127.0.0.1' } } as any;
    expect(trustedClientIp(request, secret)).toBe('127.0.0.1');
    request.headers['x-peopleflow-proxy-key'] = secret;
    expect(trustedClientIp(request, secret)).toBe('203.0.113.5');
    request.headers['x-peopleflow-client-ip'] = 'not-an-ip';
    expect(trustedClientIp(request, secret)).toBe('127.0.0.1');
    expect(trustedClientIp(request)).toBe('127.0.0.1');
  });
  it('requires exact origin and matching strong CSRF token', () => {
    const token = 'a'.repeat(64);
    expect(validCsrf('https://app.example', 'https://app.example', token, token)).toBe(true);
    expect(validCsrf('https://evil.example', 'https://app.example', token, token)).toBe(false);
    expect(validCsrf(undefined, 'https://app.example', token, token)).toBe(false);
    expect(validCsrf('https://app.example', 'https://app.example', token, 'b'.repeat(64))).toBe(false);
    expect(validCsrf('https://app.example', 'https://app.example', 'a', 'a')).toBe(false);
  });
  it('rejects mass-assignment and omits supplied secret values from validation errors', () => {
    const pipe = new ZodPipe(loginSchema);
    try { pipe.transform({ tenantSlug: 'acme', companySlug: 'main', email: 'person@example.com', password: 'SECRET_SENTINEL', role: 'ADMIN' }); throw new Error('Expected rejection'); }
    catch (error: any) { expect(error.getStatus()).toBe(400); expect(JSON.stringify(error.getResponse())).not.toContain('SECRET_SENTINEL'); }
    expect(pipe.transform({ tenantSlug: 'acme', companySlug: 'main', email: 'PERSON@example.com', password: 'valid-password' }).email).toBe('person@example.com');
  });
});

describe('JWT verification', () => {
  const secret = 's'.repeat(64);
  const claims = { sub: 'e32e6b70-f2ea-4a2e-80b3-499263951919', tenantId: '8184be17-cdd4-4c47-95a9-9697d1397d7e', companyId: '0ebd33a7-72bc-4361-84cc-cd6edb1bd176', sessionId: '42f5d1a2-7d7a-4cd7-a6ec-96a23ba5c17c', version: 0 };
  const jwt = new JwtService();
  const config = { values: { JWT_SECRET: secret, DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64') } } as AppConfig;
  it('rejects wrong audience, issuer, signature, algorithm and expiration without querying private data', async () => {
    const db = { withScope: vi.fn() } as unknown as DatabaseService;
    const auth = new AuthService(db, config);
    const variants = [
      jwt.sign(claims, { secret, issuer: 'other', audience: 'peopleflow-web', expiresIn: '1m' }),
      jwt.sign(claims, { secret, issuer: 'peopleflow', audience: 'other', expiresIn: '1m' }),
      jwt.sign(claims, { secret: 'other-secret', issuer: 'peopleflow', audience: 'peopleflow-web', expiresIn: '1m' }),
      jwt.sign(claims, { secret, algorithm: 'HS384', issuer: 'peopleflow', audience: 'peopleflow-web', expiresIn: '1m' }),
      jwt.sign(claims, { secret, issuer: 'peopleflow', audience: 'peopleflow-web', expiresIn: -1 }),
    ];
    for (const token of variants) await expect(auth.authenticate(token)).rejects.toMatchObject({ status: 401 });
    expect(db.withScope).not.toHaveBeenCalled();
  });
  it('queries the session and current user version even for a valid signature', async () => {
    const tx = { authSession: { findFirst: vi.fn().mockResolvedValue(null) } };
    const db = { withScope: vi.fn((_scope, callback) => callback(tx)) } as unknown as DatabaseService;
    const auth = new AuthService(db, config);
    const token = jwt.sign(claims, { secret, issuer: 'peopleflow', audience: 'peopleflow-web', expiresIn: '1m' });
    await expect(auth.authenticate(token)).rejects.toMatchObject({ status: 401 });
    expect(tx.authSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: claims.sessionId, userId: claims.sub, revokedAt: null }) }));
  });
});
