import 'reflect-metadata';
import { randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import request from 'supertest';
import { authenticator } from 'otplib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// This suite only mutates a dedicated test database. It never migrates or resets a database.
const runtimeUrl = process.env.TEST_DATABASE_URL;
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL;
const redisUrl = process.env.TEST_REDIS_URL;

function requireTestDatabase(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} must point to a dedicated migrated PostgreSQL test database.`);
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/(^|[_-])test([_-]|$)/i.test(url.pathname.slice(1))) {
    throw new Error(`${name} database name must include a separate 'test' segment.`);
  }
  return value;
}

type TestClient = { cookies: string[]; csrf: string };
const ids = {
  tenantA: randomUUID(), tenantB: randomUUID(), companyA: randomUUID(), companyA2: randomUUID(), companyB: randomUUID(),
  admin: randomUUID(), hr: randomUUID(), manager: randomUUID(), employee: randomUUID(), disabled: randomUUID(),
  adminA2: randomUUID(), adminB: randomUUID(), ownEmployee: randomUUID(), teammate: randomUUID(), terminated: randomUUID(),
  otherCompanyEmployee: randomUUID(), otherTenantEmployee: randomUUID(),
};
const suffix = randomUUID().slice(0, 8);
const password = `PeopleFlow-test-${randomBytes(18).toString('base64url')}`;
const tenantSlugA = `integration-a-${suffix}`;
const tenantSlugB = `integration-b-${suffix}`;
const origin = 'http://localhost:3000';
const base = '/api/v1';
const fixtureInput = { registration: 'F004', fullName: 'Pessoa de integração', jobTitle: 'Analista', departmentName: 'Operações', hiredAt: '2026-01-12' };
let app: INestApplication;
let adminDatabase: PrismaClient;
let runtimeDatabase: PrismaClient;
let clients: { admin: TestClient; hr: TestClient; employee: TestClient; manager: TestClient; adminA2: TestClient; adminB: TestClient; disabled: TestClient };
let createdId: string;

function absorbCookies(client: TestClient, response: request.Response) {
  const setCookie = response.headers['set-cookie'];
  const incoming = typeof setCookie === 'string' ? [setCookie] : (setCookie ?? []);
  for (const cookie of incoming) {
    const pair = cookie.split(';', 1)[0];
    const name = pair.split('=', 1)[0];
    client.cookies = client.cookies.filter((item) => !item.startsWith(`${name}=`));
    client.cookies.push(pair);
  }
}

function get(path: string, client: TestClient) {
  return request(app.getHttpServer()).get(`${base}${path}`).set('Cookie', client.cookies);
}

function mutate(method: 'post' | 'patch', path: string, client: TestClient, body: unknown = {}) {
  return request(app.getHttpServer())[method](`${base}${path}`).set('Cookie', client.cookies).set('Origin', origin).set('x-csrf-token', client.csrf).send(body);
}

async function login(email: string, companySlug = 'primary', tenantSlug = tenantSlugA, loginPassword = password, mfaCode?: string): Promise<TestClient> {
  const client: TestClient = { cookies: [], csrf: '' };
  const csrf = await request(app.getHttpServer()).get(`${base}/auth/csrf`).expect(200);
  absorbCookies(client, csrf);
  client.csrf = csrf.body.csrfToken;
  const loggedIn = await mutate('post', '/auth/login', client, { tenantSlug, companySlug, email, password: loginPassword, ...(mfaCode ? { mfaCode } : {}) }).expect(200);
  absorbCookies(client, loggedIn);
  return client;
}

beforeAll(async () => {
  const runtime = requireTestDatabase(runtimeUrl, 'TEST_DATABASE_URL');
  const admin = requireTestDatabase(adminUrl, 'TEST_DATABASE_ADMIN_URL');
  if (new URL(runtime).pathname !== new URL(admin).pathname || new URL(runtime).host !== new URL(admin).host) throw new Error('Test admin and runtime must target the same database.');
  if (!redisUrl || !['redis:', 'rediss:'].includes(new URL(redisUrl).protocol) || !/^\/(?:[1-9]|1[0-5])$/.test(new URL(redisUrl).pathname)) throw new Error('TEST_REDIS_URL must use a dedicated nonzero Redis database.');
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = runtime;
  process.env.REDIS_URL = redisUrl;
  process.env.REDIS_PREFIX = `peopleflow-integration-${suffix}`;
  process.env.WEB_ORIGIN = origin;
  process.env.JWT_SECRET = randomBytes(48).toString('base64url');
  process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.RATE_LIMIT_MAX = '500';
  process.env.RATE_LIMIT_LOGIN_MAX = '500';

  adminDatabase = new PrismaClient({ adapter: new PrismaPg({ connectionString: admin }) });
  runtimeDatabase = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtime }) });
  await Promise.all([adminDatabase.$connect(), runtimeDatabase.$connect()]);
  const hash = await argon2.hash(password);
  await adminDatabase.tenant.createMany({ data: [{ id: ids.tenantA, slug: tenantSlugA, name: 'Integration Tenant A' }, { id: ids.tenantB, slug: tenantSlugB, name: 'Integration Tenant B' }] });
  await adminDatabase.company.createMany({ data: [
    { id: ids.companyA, tenantId: ids.tenantA, slug: 'primary', name: 'Integration Company A' },
    { id: ids.companyA2, tenantId: ids.tenantA, slug: 'secondary', name: 'Integration Company A2' },
    { id: ids.companyB, tenantId: ids.tenantB, slug: 'primary', name: 'Integration Company B' },
  ] });
  const user = (id: string, email: string, role: Role, tenantId = ids.tenantA, companyId = ids.companyA) => ({ id, tenantId, companyId, email, name: 'Pessoa de teste', passwordHash: hash, role });
  await adminDatabase.user.createMany({ data: [
    user(ids.admin, 'admin@example.test', 'ADMIN'), user(ids.hr, 'hr@example.test', 'HR'),
    user(ids.manager, 'manager@example.test', 'MANAGER'), user(ids.employee, 'employee@example.test', 'EMPLOYEE'),
    user(ids.disabled, 'disabled@example.test', 'EMPLOYEE'), user(ids.adminA2, 'admin@example.test', 'ADMIN', ids.tenantA, ids.companyA2),
    user(ids.adminB, 'admin@example.test', 'ADMIN', ids.tenantB, ids.companyB),
  ] });
  const employee = (id: string, registration: string, fullName: string, status: 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED', tenantId = ids.tenantA, companyId = ids.companyA) => ({
    id, tenantId, companyId, registration, fullName, jobTitle: 'Analista', departmentName: status === 'TERMINATED' ? 'Financeiro' : 'Operações', hiredAt: new Date('2026-01-01T00:00:00Z'), status,
  });
  await adminDatabase.employee.createMany({ data: [
    { ...employee(ids.ownEmployee, 'F001', 'Ana Pessoa', 'ACTIVE'), userId: ids.employee },
    employee(ids.teammate, 'F002', 'Bruno Pessoa', 'ON_LEAVE'), employee(ids.terminated, 'F003', 'Carla Pessoa', 'TERMINATED'),
    employee(ids.otherCompanyEmployee, 'F001', 'Segredo empresa A2', 'ACTIVE', ids.tenantA, ids.companyA2),
    employee(ids.otherTenantEmployee, 'F001', 'Segredo tenant B', 'ACTIVE', ids.tenantB, ids.companyB),
  ] });
  const { createApp } = await import('../../src/app');
  app = await createApp();
  await app.init();
  clients = {
    admin: await login('admin@example.test'), hr: await login('hr@example.test'), employee: await login('employee@example.test'),
    manager: await login('manager@example.test'), adminA2: await login('admin@example.test', 'secondary'),
    adminB: await login('admin@example.test', 'primary', tenantSlugB), disabled: await login('disabled@example.test'),
  };
}, 60_000);

afterAll(async () => {
  await app?.close();
  await runtimeDatabase?.$disconnect();
  if (adminDatabase) {
    const where = { tenantId: { in: [ids.tenantA, ids.tenantB] } };
    await adminDatabase.$transaction(async (tx) => {
      await tx.auditLog.deleteMany({ where });
      await tx.mfaRecoveryCode.deleteMany({ where });
      await tx.mfaCredential.deleteMany({ where });
      await tx.authSession.deleteMany({ where });
      await tx.employee.deleteMany({ where });
      await tx.user.deleteMany({ where });
      await tx.company.deleteMany({ where });
      await tx.tenant.deleteMany({ where: { id: { in: [ids.tenantA, ids.tenantB] } } });
    });
    await adminDatabase.$disconnect();
  }
}, 60_000);

describe('PostgreSQL isolation and real HTTP employee workflows', { timeout: 30_000 }, () => {
  it('uses a runtime role without superuser/BYPASSRLS and fails closed without context', async () => {
    const [role] = await runtimeDatabase.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(role).toEqual({ rolsuper: false, rolbypassrls: false });
    expect(await runtimeDatabase.$queryRaw`SELECT id FROM employees`).toEqual([]);
  });

  it('enforces RLS for raw queries and resets context at the transaction boundary', async () => {
    const visible = await runtimeDatabase.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ids.tenantA}, true), set_config('app.company_id', ${ids.companyA}, true)`;
      const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM employees ORDER BY id`;
      const changed = await tx.$executeRaw`UPDATE employees SET full_name = 'Tentativa bloqueada' WHERE id = ${ids.otherCompanyEmployee}::uuid`;
      expect(changed).toBe(0);
      return rows.map((row) => row.id).sort();
    });
    expect(visible).toEqual([ids.ownEmployee, ids.teammate, ids.terminated].sort());
    expect(await runtimeDatabase.$queryRaw`SELECT id FROM employees`).toEqual([]);
    const protectedTables = await runtimeDatabase.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`SELECT relname::text, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('users', 'employees', 'auth_sessions', 'mfa_credentials', 'mfa_recovery_codes', 'audit_logs') ORDER BY relname`;
    expect(protectedTables).toHaveLength(6);
    expect(protectedTables.every((table) => table.relrowsecurity && table.relforcerowsecurity)).toBe(true);
  });

  it('rejects direct foreign-company inserts and user links even when application validation is bypassed', async () => {
    await expect(runtimeDatabase.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ids.tenantA}, true), set_config('app.company_id', ${ids.companyA}, true)`;
      await tx.employee.create({ data: { ...fixtureInput, hiredAt: new Date('2026-01-12'), tenantId: ids.tenantA, companyId: ids.companyA2 } });
    })).rejects.toThrow(/row-level security policy/i);
    await expect(adminDatabase.employee.create({ data: { ...fixtureInput, hiredAt: new Date('2026-01-12'), tenantId: ids.tenantA, companyId: ids.companyA, userId: ids.adminA2 } })).rejects.toThrow(/foreign key constraint/i);
  });

  it('returns only the authenticated company and its real dashboard', async () => {
    const company = await get('/companies', clients.admin).expect(200);
    expect(company.body.items).toEqual([{ id: ids.companyA, name: 'Integration Company A', slug: 'primary' }]);
    const dashboard = await get('/dashboard', clients.admin).expect(200);
    expect(dashboard.body).toMatchObject({ totalEmployees: 3, activeEmployees: 1, onLeaveEmployees: 1, terminatedEmployees: 1, departments: 2 });
    expect(dashboard.body.recentAdmissions.map((item: { id: string }) => item.id).sort()).toEqual([ids.ownEmployee, ids.teammate, ids.terminated].sort());
  });

  it('supports stable pagination, status and case-insensitive search', async () => {
    const first = await get('/employees?page=1&pageSize=1', clients.admin).expect(200);
    expect(first.body).toMatchObject({ total: 3, page: 1, pageSize: 1 });
    expect(first.body.items[0].id).toBe(ids.ownEmployee);
    const second = await get('/employees?page=2&pageSize=1', clients.admin).expect(200);
    expect(second.body.items[0].id).toBe(ids.teammate);
    const filtered = await get('/employees?q=bRuNo&status=ON_LEAVE', clients.admin).expect(200);
    expect(filtered.body.total).toBe(1);
    expect(filtered.body.items[0].id).toBe(ids.teammate);
    expect(filtered.body.items[0]).not.toHaveProperty('tenantId');
    expect(filtered.body.items[0]).not.toHaveProperty('userId');
  });

  it.each(['otherCompanyEmployee', 'otherTenantEmployee'] as const)('cannot read or mutate another company record: %s', async (key) => {
    await get(`/employees/${ids[key]}`, clients.admin).expect(404);
    await mutate('patch', `/employees/${ids[key]}`, clients.admin, { fullName: 'Ataque bloqueado' }).expect(404);
    const original = await adminDatabase.employee.findUniqueOrThrow({ where: { id: ids[key] } });
    expect(original.fullName).toMatch(/^Segredo /);
  });

  it('rejects scope forgery and unknown fields before any database write', async () => {
    for (const field of ['tenantId', 'companyId', 'userId']) {
      await mutate('post', '/employees', clients.admin, { ...fixtureInput, [field]: ids.companyA2 }).expect(400);
      await mutate('patch', `/employees/${ids.ownEmployee}`, clients.admin, { fullName: 'Ataque', [field]: ids.companyA2 }).expect(400);
    }
    expect(await adminDatabase.employee.count({ where: { tenantId: ids.tenantA, companyId: ids.companyA } })).toBe(3);
  });

  it('restricts employee self-service to the linked record and denies broad manager access', async () => {
    const mine = await get('/employees', clients.employee).expect(200);
    expect(mine.body.total).toBe(1);
    expect(mine.body.items[0].id).toBe(ids.ownEmployee);
    await get(`/employees/${ids.ownEmployee}`, clients.employee).expect(200);
    await get(`/employees/${ids.teammate}`, clients.employee).expect(404);
    await mutate('post', '/employees', clients.employee, fixtureInput).expect(403);
    await mutate('patch', `/employees/${ids.ownEmployee}`, clients.employee, { fullName: 'Tentativa' }).expect(403);
    await get('/dashboard', clients.employee).expect(403);
    await get('/employees', clients.manager).expect(403);
    await get('/dashboard', clients.manager).expect(403);
  });

  it('rejects invalid dates, IDs, pagination and empty updates', async () => {
    await mutate('post', '/employees', clients.admin, { ...fixtureInput, hiredAt: '2026-02-30' }).expect(400);
    await mutate('patch', `/employees/${ids.ownEmployee}`, clients.admin, {}).expect(400);
    await get('/employees/not-a-uuid', clients.admin).expect(400);
    await get('/employees?pageSize=101', clients.admin).expect(400);
    await get('/employees?page=0', clients.admin).expect(400);
  });

  it('persists HR create/update atomically with audit entries containing no employee PII', async () => {
    const created = await mutate('post', '/employees', clients.hr, fixtureInput).expect(201);
    createdId = created.body.id;
    expect(created.body).toMatchObject({ ...fixtureInput, email: null, status: 'ACTIVE' });
    await mutate('patch', `/employees/${createdId}`, clients.hr, { status: 'ON_LEAVE' }).expect(200);
    expect((await get(`/employees/${createdId}`, clients.admin).expect(200)).body.status).toBe('ON_LEAVE');
    const logs = await adminDatabase.auditLog.findMany({ where: { tenantId: ids.tenantA, companyId: ids.companyA, entityId: createdId }, orderBy: { createdAt: 'asc' } });
    expect(logs.map((log) => log.action)).toEqual(['employee.created', 'employee.updated']);
    expect(logs.every((log) => log.userId === ids.hr && JSON.stringify(log.metadata) === '{}')).toBe(true);
    await expect(runtimeDatabase.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ids.tenantA}, true), set_config('app.company_id', ${ids.companyA}, true)`;
      await tx.$executeRaw`UPDATE audit_logs SET action = 'tampered' WHERE id = ${logs[0].id}::uuid`;
    })).rejects.toThrow(/permission denied/i);
    await mutate('post', '/employees', clients.hr, fixtureInput).expect(409);
    await mutate('post', '/employees', clients.adminA2, fixtureInput).expect(201);
  });

  it('requires CSRF and the configured Origin for mutations', async () => {
    await request(app.getHttpServer()).post(`${base}/employees`).set('Cookie', clients.admin.cookies).set('Origin', origin).send({ ...fixtureInput, registration: 'F005' }).expect(403);
    await request(app.getHttpServer()).post(`${base}/employees`).set('Cookie', clients.admin.cookies).set('Origin', 'https://attacker.example').set('x-csrf-token', clients.admin.csrf).send({ ...fixtureInput, registration: 'F005' }).expect(403);
  });

  it('revokes access and refresh immediately when a user is disabled', async () => {
    await adminDatabase.user.update({ where: { id: ids.disabled }, data: { isActive: false } });
    await get('/auth/me', clients.disabled).expect(401);
    await mutate('post', '/auth/refresh', clients.disabled).expect(401);
  });

  it('rotates refresh tokens and revokes the entire session after a proven replay', async () => {
    const current = await login('admin@example.test');
    const old = { cookies: [...current.cookies], csrf: current.csrf };
    const refresh = await mutate('post', '/auth/refresh', current).expect(200);
    absorbCookies(current, refresh);
    expect(current.cookies.find((cookie) => cookie.startsWith('refresh_token='))).not.toBe(old.cookies.find((cookie) => cookie.startsWith('refresh_token=')));
    await mutate('post', '/auth/refresh', old).expect(401);
    await get('/auth/me', current).expect(401);
    await mutate('post', '/auth/refresh', current).expect(401);
  });

  it('serializes simultaneous refreshes and revokes the session when the same token is reused', async () => {
    const concurrent = await login('admin@example.test');
    const results = await Promise.all([mutate('post', '/auth/refresh', concurrent), mutate('post', '/auth/refresh', concurrent)]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 401]);
    absorbCookies(concurrent, results.find((response) => response.status === 200)!);
    await get('/auth/me', concurrent).expect(401);
  });

  it('rejects both access and refresh after explicit account token-version invalidation', async () => {
    const stale = await login('admin@example.test');
    await adminDatabase.user.update({ where: { id: ids.admin }, data: { tokenVersion: { increment: 1 } } });
    await get('/auth/me', stale).expect(401);
    await mutate('post', '/auth/refresh', stale).expect(401);
  });

  it('blocks guessed refresh secrets and logout using another user session without revoking its victim', async () => {
    const victim = await login('admin@example.test', 'primary', tenantSlugB);
    const attacker = await login('admin@example.test');
    const victimRefresh = victim.cookies.find((cookie) => cookie.startsWith('refresh_token='))!;
    const token = decodeURIComponent(victimRefresh.slice('refresh_token='.length));
    const parts = token.split('.');
    parts[3] = randomBytes(32).toString('hex');
    const guessed = { cookies: [...attacker.cookies.filter((cookie) => !cookie.startsWith('refresh_token=')), `refresh_token=${encodeURIComponent(parts.join('.'))}`], csrf: attacker.csrf };
    await mutate('post', '/auth/refresh', guessed).expect(401);
    const stolen = { cookies: [...attacker.cookies.filter((cookie) => !cookie.startsWith('refresh_token=')), victimRefresh], csrf: attacker.csrf };
    await mutate('post', '/auth/logout', stolen).expect(401);
    await get('/auth/me', victim).expect(200);
    const snapshot = { cookies: [...victim.cookies], csrf: victim.csrf };
    await mutate('post', '/auth/logout', victim).expect(204);
    await get('/auth/me', snapshot).expect(401);
    await mutate('post', '/auth/refresh', snapshot).expect(401);
  });

  it('enrolls encrypted MFA, requires a second factor and consumes recovery codes once', async () => {
    const mfa = await login('manager@example.test');
    const original = { cookies: [...mfa.cookies], csrf: mfa.csrf };
    const setup = await mutate('post', '/auth/mfa/setup', mfa, { currentPassword: password }).expect(200);
    const secret = new URL(setup.body.otpauthUri).searchParams.get('secret')!;
    const enablingCode = authenticator.generate(secret);
    const enabled = await mutate('post', '/auth/mfa/enable', mfa, { code: enablingCode }).expect(200);
    expect(enabled.body.recoveryCodes).toHaveLength(10);
    const credential = await adminDatabase.mfaCredential.findUniqueOrThrow({ where: { userId: ids.manager } });
    expect(credential.secretEncrypted).toMatch(/^v1\./);
    expect(credential.secretEncrypted).not.toContain(secret);
    await get('/auth/me', original).expect(401);
    const missing = await mutate('post', '/auth/login', mfa, { tenantSlug: tenantSlugA, companySlug: 'primary', email: 'manager@example.test', password }).expect(401);
    expect(missing.body.code).toBe('MFA_REQUIRED');
    await mutate('post', '/auth/login', mfa, { tenantSlug: tenantSlugA, companySlug: 'primary', email: 'manager@example.test', password, mfaCode: enablingCode }).expect(401);
    const recovered = await login('manager@example.test', 'primary', tenantSlugA, password, enabled.body.recoveryCodes[0]);
    await mutate('post', '/auth/login', mfa, { tenantSlug: tenantSlugA, companySlug: 'primary', email: 'manager@example.test', password, mfaCode: enabled.body.recoveryCodes[0] }).expect(401);
    await mutate('post', '/auth/mfa/disable', recovered, { currentPassword: password, code: enabled.body.recoveryCodes[1] }).expect(204);
    await get('/auth/me', recovered).expect(401);
    await get('/auth/me', await login('manager@example.test')).expect(200);
  });

  it('invalidates all sessions and old passwords after a password change', async () => {
    const second = await login('hr@example.test');
    const changedPassword = `PeopleFlow-new-${randomBytes(18).toString('base64url')}`;
    await mutate('post', '/auth/change-password', clients.hr, { currentPassword: password, newPassword: changedPassword }).expect(204);
    await get('/auth/me', clients.hr).expect(401);
    await get('/auth/me', second).expect(401);
    await mutate('post', '/auth/refresh', second).expect(401);
    await mutate('post', '/auth/login', second, { tenantSlug: tenantSlugA, companySlug: 'primary', email: 'hr@example.test', password }).expect(401);
    await get('/auth/me', await login('hr@example.test', 'primary', tenantSlugA, changedPassword)).expect(200);
  });

  it('enforces Redis-backed rate limits in a separate application instance', async () => {
    const previousLimit = process.env.RATE_LIMIT_MAX;
    const previousPrefix = process.env.REDIS_PREFIX;
    process.env.RATE_LIMIT_MAX = '2';
    process.env.REDIS_PREFIX = `peopleflow-integration-${suffix}-limiter`;
    const { createApp } = await import('../../src/app');
    const limitedApp = await createApp();
    try {
      await limitedApp.init();
      const csrf = await request(limitedApp.getHttpServer()).get(`${base}/auth/csrf`).expect(200);
      const limiterClient: TestClient = { cookies: [], csrf: csrf.body.csrfToken };
      absorbCookies(limiterClient, csrf);
      for (const expectedStatus of [401, 401, 429]) {
        await request(limitedApp.getHttpServer()).post(`${base}/auth/login`).set('Cookie', limiterClient.cookies).set('Origin', origin).set('x-csrf-token', limiterClient.csrf).send({ tenantSlug: tenantSlugA, companySlug: 'primary', email: 'admin@example.test', password: 'wrong-password' }).expect(expectedStatus);
      }
    } finally {
      await limitedApp.close();
      process.env.RATE_LIMIT_MAX = previousLimit;
      process.env.REDIS_PREFIX = previousPrefix;
    }
  });
});
