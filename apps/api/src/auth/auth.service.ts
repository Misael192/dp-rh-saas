import { BadRequestException, Inject, Injectable, OnModuleInit, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import { authenticator } from 'otplib';
import { z } from 'zod';
import { AppConfig } from '../common/config';
import { DatabaseService } from '../database/database.service';
import { AccessClaims, AuthUser, SessionUser } from './auth.types';
import { LoginInput } from './auth.schemas';
import { decryptSecret, encryptSecret, equalHash, hashToken, normalizeRecoveryCode, parseRefreshToken, randomSecret, recoveryCode, verifyTotpStep } from './crypto';

const claimsSchema = z.object({ sub: z.string().uuid(), tenantId: z.string().uuid(), companyId: z.string().uuid(), sessionId: z.string().uuid(), version: z.number().int().nonnegative(), iat: z.number().int(), exp: z.number().int() });
const passwordOptions = { type: argon2.argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 };
const sessionLifetime = 7 * 24 * 60 * 60 * 1000;
export interface AuthTokens { user: SessionUser; accessToken: string; refreshToken: string; refreshExpiresAt: Date; }
const failure = () => new UnauthorizedException({ code: 'AUTHENTICATION_FAILED', message: 'Credenciais ou sessão inválidas.' });

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly jwt = new JwtService();
  private readonly encryptionKey: Buffer;
  private dummyHash = '';
  constructor(@Inject(DatabaseService) private readonly db: DatabaseService, @Inject(AppConfig) private readonly config: AppConfig) {
    this.encryptionKey = Buffer.from(config.values.DATA_ENCRYPTION_KEY, 'base64');
  }
  async onModuleInit() { this.dummyHash = await argon2.hash(randomSecret(), passwordOptions); }

  private async userView(tx: Prisma.TransactionClient, user: User): Promise<SessionUser> {
    const [company, tenant] = await Promise.all([
      tx.company.findFirst({ where: { id: user.companyId, tenantId: user.tenantId, isActive: true } }),
      tx.tenant.findFirst({ where: { id: user.tenantId, isActive: true } }),
    ]);
    if (!user.isActive || !company || !tenant) throw failure();
    return { id: user.id, name: user.name, email: user.email, role: user.role, tenantId: user.tenantId, companyId: user.companyId, companyName: company.name, tenantName: tenant.name, mfaEnabled: user.mfaEnabled };
  }

  async login(input: LoginInput): Promise<AuthTokens> {
    const tenant = await this.db.tenant.findFirst({ where: { slug: input.tenantSlug, isActive: true }, select: { id: true } });
    const company = tenant ? await this.db.withScope({ tenantId: tenant.id }, tx => tx.company.findFirst({ where: { tenantId: tenant.id, slug: input.companySlug, isActive: true }, select: { id: true } })) : null;
    const scope = tenant && company ? { tenantId: tenant.id, companyId: company.id } : null;
    const candidate = scope ? await this.db.withScope(scope, tx => tx.user.findFirst({ where: { ...scope, email: input.email } })) : null;
    const passwordMatches = await argon2.verify(candidate?.passwordHash ?? this.dummyHash, input.password).catch(() => false);
    if (!candidate || !scope || !passwordMatches || !candidate.isActive) throw failure();
    return this.db.withScope(scope, async tx => {
      await this.lockUser(tx, candidate.id);
      const user = await tx.user.findFirst({ where: { id: candidate.id, ...scope } });
      if (!user || !user.isActive || user.passwordHash !== candidate.passwordHash) throw failure();
      const view = await this.userView(tx, user);
      if (user.mfaEnabled) {
        if (!input.mfaCode) throw new UnauthorizedException({ code: 'MFA_REQUIRED', message: 'Informe o código de autenticação em dois fatores.' });
        if (!await this.consumeMfa(tx, user, input.mfaCode)) throw failure();
      }
      const sessionId = randomUUID();
      const refreshToken = this.refreshString(scope, sessionId);
      const refreshExpiresAt = new Date(Date.now() + sessionLifetime);
      await tx.authSession.create({ data: { id: sessionId, ...scope, userId: user.id, tokenVersion: user.tokenVersion, refreshTokenHash: hashToken(refreshToken), expiresAt: refreshExpiresAt } });
      await this.audit(tx, user, 'auth.login', sessionId);
      return { user: view, refreshToken, refreshExpiresAt, accessToken: this.accessToken(user, sessionId) };
    });
  }

  async authenticate(raw: unknown): Promise<AuthUser> {
    if (typeof raw !== 'string' || raw.length > 4096) throw failure();
    let claims: AccessClaims;
    try {
      claims = claimsSchema.parse(this.jwt.verify(raw, { secret: this.config.values.JWT_SECRET, algorithms: ['HS256'], issuer: 'peopleflow', audience: 'peopleflow-web' }));
    } catch { throw failure(); }
    return this.db.withScope(claims, async tx => {
      const session = await tx.authSession.findFirst({ where: { id: claims.sessionId, userId: claims.sub, tenantId: claims.tenantId, companyId: claims.companyId, revokedAt: null, expiresAt: { gt: new Date() } } });
      const user = session ? await tx.user.findFirst({ where: { id: claims.sub, tenantId: claims.tenantId, companyId: claims.companyId, isActive: true, tokenVersion: claims.version } }) : null;
      if (!user) throw failure();
      return { ...await this.userView(tx, user), sessionId: claims.sessionId, tokenVersion: user.tokenVersion };
    });
  }

  async refresh(raw: unknown): Promise<AuthTokens> {
    const parsed = parseRefreshToken(raw);
    if (!parsed || typeof raw !== 'string') throw failure();
    const result = await this.db.withScope(parsed, async tx => {
      await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${parsed.sessionId}::uuid FOR UPDATE`;
      const session = await tx.authSession.findFirst({ where: { id: parsed.sessionId, tenantId: parsed.tenantId, companyId: parsed.companyId } });
      if (!session || session.revokedAt || session.expiresAt <= new Date()) return null;
      const hash = hashToken(raw);
      if (!equalHash(session.refreshTokenHash, hash)) {
        // Only a previously issued secret proves replay. A guessed secret cannot revoke another session.
        if (session.previousRefreshTokenHashes.some(previous => equalHash(previous, hash))) {
          await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
          await tx.auditLog.create({ data: { tenantId: session.tenantId, companyId: session.companyId, userId: session.userId, action: 'auth.refresh_replay', entityId: session.id, metadata: {} } });
        }
        return null;
      }
      const user = await tx.user.findFirst({ where: { id: session.userId, tenantId: parsed.tenantId, companyId: parsed.companyId, isActive: true } });
      const company = await tx.company.findFirst({ where: { id: parsed.companyId, tenantId: parsed.tenantId, isActive: true } });
      const tenant = await tx.tenant.findFirst({ where: { id: parsed.tenantId, isActive: true } });
      if (!user || !company || !tenant || user.tokenVersion !== session.tokenVersion || session.previousRefreshTokenHashes.length >= 2048) {
        await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
        return null;
      }
      const refreshToken = this.refreshString(parsed, session.id);
      await tx.authSession.update({ where: { id: session.id }, data: { refreshTokenHash: hashToken(refreshToken), previousRefreshTokenHashes: { push: hash }, rotationCounter: { increment: 1 } } });
      await this.audit(tx, user, 'auth.refresh', session.id);
      return { user: await this.userView(tx, user), refreshToken, refreshExpiresAt: session.expiresAt, accessToken: this.accessToken(user, session.id) };
    });
    if (!result) throw failure();
    return result;
  }

  async logout(actor: AuthUser, raw: unknown) {
    const parsed = parseRefreshToken(raw);
    if (!parsed || typeof raw !== 'string' || parsed.sessionId !== actor.sessionId || parsed.tenantId !== actor.tenantId || parsed.companyId !== actor.companyId) throw failure();
    await this.db.withScope(actor, async tx => {
      await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${actor.sessionId}::uuid FOR UPDATE`;
      const session = await tx.authSession.findFirst({ where: { id: actor.sessionId, tenantId: actor.tenantId, companyId: actor.companyId, userId: actor.id, revokedAt: null } });
      const hash = hashToken(raw);
      if (!session || (!equalHash(session.refreshTokenHash, hash) && !session.previousRefreshTokenHashes.some(previous => equalHash(previous, hash)))) throw failure();
      await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      await this.audit(tx, actor, 'auth.logout', session.id);
    });
  }

  async changePassword(actor: AuthUser, currentPassword: string, newPassword: string) {
    const candidate = await this.passwordCandidate(actor, currentPassword);
    if (await argon2.verify(candidate.passwordHash, newPassword)) throw new BadRequestException({ code: 'PASSWORD_UNCHANGED', message: 'Escolha uma senha diferente da atual.' });
    const newHash = await argon2.hash(newPassword, passwordOptions);
    await this.db.withScope(actor, async tx => {
      await this.assertSensitiveUser(tx, actor, candidate.passwordHash);
      await tx.user.update({ where: { id: actor.id }, data: { passwordHash: newHash, tokenVersion: { increment: 1 } } });
      await this.revokeSessions(tx, actor);
      await this.audit(tx, actor, 'auth.password_changed', actor.id);
    });
  }

  async setupMfa(actor: AuthUser, currentPassword: string) {
    const candidate = await this.passwordCandidate(actor, currentPassword);
    const secret = authenticator.generateSecret();
    await this.db.withScope(actor, async tx => {
      const user = await this.assertSensitiveUser(tx, actor, candidate.passwordHash);
      if (user.mfaEnabled) throw new BadRequestException('Dois fatores já está ativado.');
      const pendingSecretEncrypted = encryptSecret(JSON.stringify({ secret, createdAt: Date.now() }), this.encryptionKey, this.mfaContext(actor));
      await tx.mfaCredential.upsert({ where: { userId: actor.id }, create: { tenantId: actor.tenantId, companyId: actor.companyId, userId: actor.id, pendingSecretEncrypted }, update: { pendingSecretEncrypted } });
      await this.audit(tx, actor, 'auth.mfa_setup', actor.id);
    });
    return { otpauthUri: authenticator.keyuri(actor.email, 'PeopleFlow', secret) };
  }

  async enableMfa(actor: AuthUser, code: string) {
    const codes = Array.from({ length: 10 }, recoveryCode);
    await this.db.withScope(actor, async tx => {
      const user = await this.assertSensitiveUser(tx, actor);
      const credential = await tx.mfaCredential.findUnique({ where: { userId: actor.id } });
      if (user.mfaEnabled || !credential?.pendingSecretEncrypted) throw new BadRequestException('Configure os dois fatores antes de ativá-los.');
      let pending: { secret: string; createdAt: number };
      try { pending = z.object({ secret: z.string(), createdAt: z.number() }).parse(JSON.parse(decryptSecret(credential.pendingSecretEncrypted, this.encryptionKey, this.mfaContext(actor)))); } catch { throw failure(); }
      if (Date.now() - pending.createdAt > 10 * 60 * 1000 || pending.createdAt > Date.now()) throw new BadRequestException('A configuração expirou. Inicie novamente.');
      const step = verifyTotpStep(pending.secret, code, null);
      if (step === null) throw failure();
      await tx.mfaCredential.update({ where: { userId: actor.id }, data: { secretEncrypted: encryptSecret(pending.secret, this.encryptionKey, this.mfaContext(actor)), pendingSecretEncrypted: null, lastUsedStep: step } });
      await tx.user.update({ where: { id: actor.id }, data: { mfaEnabled: true, tokenVersion: { increment: 1 } } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: actor.id, tenantId: actor.tenantId, companyId: actor.companyId } });
      await tx.mfaRecoveryCode.createMany({ data: codes.map(value => ({ tenantId: actor.tenantId, companyId: actor.companyId, userId: actor.id, codeHash: hashToken(normalizeRecoveryCode(value)) })) });
      await this.revokeSessions(tx, actor);
      await this.audit(tx, actor, 'auth.mfa_enabled', actor.id);
    });
    return { recoveryCodes: codes };
  }

  async disableMfa(actor: AuthUser, currentPassword: string, code: string) {
    const candidate = await this.passwordCandidate(actor, currentPassword);
    await this.db.withScope(actor, async tx => {
      const user = await this.assertSensitiveUser(tx, actor, candidate.passwordHash);
      if (!user.mfaEnabled || !await this.consumeMfa(tx, user, code)) throw failure();
      await tx.user.update({ where: { id: actor.id }, data: { mfaEnabled: false, tokenVersion: { increment: 1 } } });
      await tx.mfaCredential.update({ where: { userId: actor.id }, data: { secretEncrypted: null, pendingSecretEncrypted: null, lastUsedStep: null } });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: actor.id, tenantId: actor.tenantId, companyId: actor.companyId } });
      await this.revokeSessions(tx, actor);
      await this.audit(tx, actor, 'auth.mfa_disabled', actor.id);
    });
  }

  private async consumeMfa(tx: Prisma.TransactionClient, user: User, code: string): Promise<boolean> {
    // All callers hold the user's row lock; recovery codes and TOTP are consumed atomically.
    const credential = await tx.mfaCredential.findUnique({ where: { userId: user.id } });
    if (!credential?.secretEncrypted) return false;
    if (/^\d{6}$/.test(code)) {
      let secret: string;
      try { secret = decryptSecret(credential.secretEncrypted, this.encryptionKey, this.mfaContext(user)); } catch { return false; }
      const step = verifyTotpStep(secret, code, credential.lastUsedStep);
      if (step === null) return false;
      await tx.mfaCredential.update({ where: { userId: user.id }, data: { lastUsedStep: step } });
      return true;
    }
    const result = await tx.mfaRecoveryCode.updateMany({ where: { tenantId: user.tenantId, companyId: user.companyId, userId: user.id, codeHash: hashToken(normalizeRecoveryCode(code)), usedAt: null }, data: { usedAt: new Date() } });
    return result.count === 1;
  }
  private async passwordCandidate(actor: AuthUser, password: string) {
    const user = await this.db.withScope(actor, tx => tx.user.findFirst({ where: { id: actor.id, tenantId: actor.tenantId, companyId: actor.companyId, isActive: true, tokenVersion: actor.tokenVersion } }));
    if (!user || !await argon2.verify(user.passwordHash, password).catch(() => false)) throw failure();
    return user;
  }
  private async assertSensitiveUser(tx: Prisma.TransactionClient, actor: AuthUser, expectedPasswordHash?: string) {
    await this.lockUser(tx, actor.id);
    const user = await tx.user.findFirst({ where: { id: actor.id, tenantId: actor.tenantId, companyId: actor.companyId, tokenVersion: actor.tokenVersion, isActive: true } });
    if (!user || (expectedPasswordHash && user.passwordHash !== expectedPasswordHash)) throw failure();
    await this.userView(tx, user);
    const session = await tx.authSession.findFirst({ where: { id: actor.sessionId, userId: actor.id, revokedAt: null, expiresAt: { gt: new Date() } } });
    if (!session) throw failure();
    return user;
  }
  // NO KEY UPDATE serializes identity changes without blocking the FK KEY SHARE lock
  // taken by session/audit inserts, avoiding user→session/session→user deadlocks.
  private lockUser(tx: Prisma.TransactionClient, userId: string) { return tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR NO KEY UPDATE`; }
  private revokeSessions(tx: Prisma.TransactionClient, actor: AuthUser) { return tx.authSession.updateMany({ where: { tenantId: actor.tenantId, companyId: actor.companyId, userId: actor.id, revokedAt: null }, data: { revokedAt: new Date() } }); }
  private mfaContext(user: { id: string; tenantId: string; companyId: string }) { return `mfa:${user.tenantId}:${user.companyId}:${user.id}`; }
  private refreshString(scope: { tenantId: string; companyId: string }, sessionId: string) { return `${scope.tenantId}.${scope.companyId}.${sessionId}.${randomSecret()}`; }
  private accessToken(user: User, sessionId: string) {
    return this.jwt.sign({ sub: user.id, tenantId: user.tenantId, companyId: user.companyId, sessionId, version: user.tokenVersion } satisfies AccessClaims, { secret: this.config.values.JWT_SECRET, algorithm: 'HS256', issuer: 'peopleflow', audience: 'peopleflow-web', expiresIn: '15m' });
  }
  private audit(tx: Prisma.TransactionClient, actor: { id: string; tenantId: string; companyId: string }, action: string, entityId: string) {
    return tx.auditLog.create({ data: { tenantId: actor.tenantId, companyId: actor.companyId, userId: actor.id, action, entityId, metadata: {} } });
  }
  publicUser(user: AuthUser): SessionUser { const { sessionId: _session, tokenVersion: _version, ...view } = user; return view; }
}
