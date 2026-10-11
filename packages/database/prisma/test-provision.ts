import { strict as assert } from 'node:assert';
import { randomBytes, randomUUID } from 'node:crypto';
import { constants, mkdtempSync, chmodSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { verify } from 'argon2';

async function main() {
  const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
  const runtimeUrl = process.env.TEST_DATABASE_URL;
  if (!adminUrl || !runtimeUrl) throw new Error('Dedicated TEST_DATABASE_ADMIN_URL and TEST_DATABASE_URL are required.');
  const adminTarget = new URL(adminUrl);
  const runtimeTarget = new URL(runtimeUrl);
  if (!decodeURIComponent(adminTarget.pathname).endsWith('_test') || adminTarget.hostname !== runtimeTarget.hostname || adminTarget.port !== runtimeTarget.port || adminTarget.pathname !== runtimeTarget.pathname) {
    throw new Error('Provisioning integration tests require matching dedicated databases ending in _test.');
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: adminUrl }) });
  const directory = mkdtempSync(join(tmpdir(), 'peopleflow-provision-test-'));
  chmodSync(directory, 0o700);
  const passwordFile = join(directory, 'admin-password');
  const password = randomBytes(24).toString('base64url');
  writeFileSync(passwordFile, password, { mode: 0o600, flag: 'wx' });
  const fixtureSlugs: string[] = [];
  const nextSlug = () => {
    const slug = `provision-${randomUUID()}`;
    fixtureSlugs.push(slug);
    return slug;
  };
  const baseEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    SEED_DEMO: 'false',
    DATABASE_ADMIN_URL: adminUrl,
    DATABASE_URL: runtimeUrl,
    PROVISION_CONFIRM_DATABASE: adminTarget.pathname,
    PROVISION_TENANT_NAME: ' Cliente Sintético ',
    PROVISION_COMPANY_SLUG: ' MATRIZ ',
    PROVISION_COMPANY_NAME: ' Empresa Sintética ',
    PROVISION_ADMIN_EMAIL: `ADMIN-${randomUUID()}@EXAMPLE.INVALID`,
    PROVISION_ADMIN_NAME: ' Administrador Sintético ',
    PROVISION_PASSWORD_FILE: passwordFile,
  };
  let checks = 0;
  const protectedValues = [password, adminUrl, runtimeUrl, baseEnvironment.PROVISION_ADMIN_EMAIL!];
  function run(overrides: NodeJS.ProcessEnv, success: boolean) {
    const result = spawnSync(process.execPath, ['--import', 'tsx', resolve(__dirname, '../src/provision.ts')], {
      env: { ...baseEnvironment, ...overrides },
      encoding: 'utf8',
      timeout: 45000,
    });
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    assert.equal(result.status, success ? 0 : 1, 'CLI exit status differed from the expected outcome.');
    for (const secret of protectedValues) {
      assert.equal(output.includes(secret), false, 'CLI output exposed a secret or personal identifier.');
    }
    checks += 1;
  }
  try {
    const [role] = await prisma.$queryRaw<Array<{ administrative_cleanup: boolean }>>`SELECT (rolsuper OR rolbypassrls) AS administrative_cleanup FROM pg_roles WHERE rolname = current_user`;
    assert.equal(role.administrative_cleanup, true, 'The isolated test admin must be able to remove its own append-only audit fixtures.');

    const slug = nextSlug();
    run({ PROVISION_TENANT_SLUG: ` ${slug.toUpperCase()} ` }, true);
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug } });
    const company = await prisma.company.findFirstOrThrow({ where: { tenantId: tenant.id } });
    const user = await prisma.user.findFirstOrThrow({ where: { tenantId: tenant.id, companyId: company.id } });
    assert.equal(tenant.name, 'Cliente Sintético');
    assert.equal(company.slug, 'matriz');
    assert.equal(company.name, 'Empresa Sintética');
    assert.equal(user.name, 'Administrador Sintético');
    assert.equal(user.email, baseEnvironment.PROVISION_ADMIN_EMAIL!.toLowerCase());
    assert.equal(user.role, Role.ADMIN);
    assert.equal(user.isActive, true);
    assert.equal(user.mfaEnabled, false);
    assert.equal(user.tokenVersion, 0);
    assert.equal(user.passwordHash.startsWith('$argon2id$'), true);
    assert.equal(await verify(user.passwordHash, password), true);
    assert.equal(await prisma.employee.count({ where: { tenantId: tenant.id } }), 0);
    const audits = await prisma.auditLog.findMany({ where: { tenantId: tenant.id } });
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'COMPANY_PROVISIONED');
    assert.equal(audits[0].userId, null);
    assert.deepEqual(audits[0].metadata, { source: 'operator-cli', version: 1 });
    checks += 1;

    // Existing tenant is rejected instead of upserted. Changing the supplied
    // names, e-mail or secret cannot change its administrator or create a branch.
    writeFileSync(passwordFile, randomBytes(24).toString('base64url'), { mode: 0o600 });
    run({ PROVISION_TENANT_SLUG: slug, PROVISION_COMPANY_SLUG: 'filial', PROVISION_ADMIN_NAME: 'Outro Nome', PROVISION_ADMIN_EMAIL: 'different@example.invalid' }, false);
    assert.deepEqual(await prisma.user.findUniqueOrThrow({ where: { id: user.id } }), user);
    assert.deepEqual(await prisma.tenant.findUniqueOrThrow({ where: { id: tenant.id } }), tenant);
    assert.equal(await prisma.company.count({ where: { tenantId: tenant.id } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: tenant.id } }), 1);
    writeFileSync(passwordFile, password, { mode: 0o600 });

    run({ PROVISION_TENANT_SLUG: nextSlug(), PROVISION_CONFIRM_DATABASE: '/incorrect_target_test' }, false);
    chmodSync(passwordFile, 0o644);
    run({ PROVISION_TENANT_SLUG: nextSlug() }, false);
    chmodSync(passwordFile, 0o600);
    const symlink = join(directory, 'password-link');
    symlinkSync(passwordFile, symlink);
    run({ PROVISION_TENANT_SLUG: nextSlug(), PROVISION_PASSWORD_FILE: symlink }, false);
    writeFileSync(passwordFile, 'a'.repeat(11), { mode: 0o600 });
    run({ PROVISION_TENANT_SLUG: nextSlug() }, false);
    writeFileSync(passwordFile, 'a'.repeat(129), { mode: 0o600 });
    run({ PROVISION_TENANT_SLUG: nextSlug() }, false);
    writeFileSync(passwordFile, password, { mode: 0o600 });
    run({ PROVISION_TENANT_SLUG: nextSlug(), DATABASE_ADMIN_URL: runtimeUrl }, false);
    run({ PROVISION_TENANT_SLUG: nextSlug(), PROVISION_ADMIN_EMAIL: 'invalid-email' }, false);
    assert.equal(await prisma.tenant.count({ where: { slug: { in: fixtureSlugs } } }), 1, 'Rejected commands must leave no tenants behind.');
    console.info(`Provisioning PostgreSQL integration checks: ${checks} PASS.`);
  } finally {
    // Only randomly named fixtures belonging to this execution are removed.
    // No shared seed, other tenant or database-wide reset is touched.
    const fixtures = await prisma.tenant.findMany({ where: { slug: { in: fixtureSlugs } }, select: { id: true } });
    for (const fixture of fixtures) {
      await prisma.$transaction(async (tx) => {
        const scope = { tenantId: fixture.id };
        await tx.auditLog.deleteMany({ where: scope });
        await tx.authSession.deleteMany({ where: scope });
        await tx.mfaRecoveryCode.deleteMany({ where: scope });
        await tx.mfaCredential.deleteMany({ where: scope });
        await tx.employee.deleteMany({ where: scope });
        await tx.user.deleteMany({ where: scope });
        await tx.company.deleteMany({ where: scope });
        await tx.tenant.delete({ where: { id: fixture.id } });
      });
    }
    await prisma.$disconnect();
    rmSync(directory, { recursive: true, force: true });
  }
}

main().catch(() => {
  // Assertions and database errors can contain credential-bearing records.
  console.error('Provisioning integration checks failed. Inspect the test assertions and isolated database configuration.');
  process.exitCode = 1;
});
