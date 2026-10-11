import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import { randomBytes, randomUUID } from 'node:crypto';

export default async function setup() {
  const runtime = new URL(process.env.TEST_DATABASE_URL ?? 'invalid:');
  const admin = new URL(process.env.TEST_DATABASE_ADMIN_URL ?? 'invalid:');
  if (!['postgres:', 'postgresql:'].includes(runtime.protocol) || !/(^|[_-])test([_-]|$)/i.test(runtime.pathname.slice(1)) || runtime.host !== admin.host || runtime.pathname !== admin.pathname) {
    throw new Error('E2E admin and runtime must target the same dedicated PostgreSQL test database.');
  }
  const database = new PrismaClient({ adapter: new PrismaPg({ connectionString: admin.toString() }) });
  const tenantId = randomUUID();
  const companyId = randomUUID();
  const tenantSlug = `browser-${randomUUID().slice(0, 8)}`;
  const password = `Browser-${randomBytes(24).toString('base64url')}`;
  if (process.env.CI) process.stdout.write(`::add-mask::${password}\n`);
  const hash = await argon2.hash(password);
  const cleanup = async () => {
    await database.$transaction(async (tx) => {
      const where = { tenantId };
      await tx.auditLog.deleteMany({ where });
      await tx.mfaRecoveryCode.deleteMany({ where });
      await tx.mfaCredential.deleteMany({ where });
      await tx.authSession.deleteMany({ where });
      await tx.employee.deleteMany({ where });
      await tx.user.deleteMany({ where });
      await tx.company.deleteMany({ where });
      await tx.tenant.deleteMany({ where: { id: tenantId } });
    });
    await database.$disconnect();
  };
  try {
    await database.$transaction(async (tx) => {
      await tx.tenant.create({ data: { id: tenantId, slug: tenantSlug, name: 'Cliente sintético E2E' } });
      await tx.company.create({ data: { id: companyId, tenantId, slug: 'primary', name: 'Empresa de testes de navegador' } });
      await tx.user.createMany({ data: [
        { tenantId, companyId, email: 'browser-admin@example.test', name: 'Administrador de teste', passwordHash: hash, role: 'ADMIN' },
        { tenantId, companyId, email: 'browser-mfa@example.test', name: 'Administrador MFA de teste', passwordHash: hash, role: 'ADMIN' },
      ] });
      await tx.employee.create({ data: { tenantId, companyId, registration: 'B001', fullName: 'Pessoa sintética inicial', jobTitle: 'Analista', departmentName: 'Operações', hiredAt: new Date('2026-01-10'), status: 'ACTIVE' } });
    });
  } catch (error) { await cleanup(); throw error; }
  Object.assign(process.env, {
    E2E_TENANT_SLUG: tenantSlug, E2E_COMPANY_SLUG: 'primary', E2E_EMAIL: 'browser-admin@example.test',
    E2E_MFA_EMAIL: 'browser-mfa@example.test', E2E_PASSWORD: password,
  });
  return cleanup;
}
