import 'reflect-metadata';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { INestApplication } from '@nestjs/common';
import { PrismaClient, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import argon2 from 'argon2';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StorageAdapter } from '../../src/storage/storage.adapter';
import { signDownloadToken, verifyDownloadToken } from '../../src/storage/download-token';

// This suite only mutates a dedicated test database. It never migrates or resets it.
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
  tenantA: randomUUID(), tenantB: randomUUID(), companyA: randomUUID(), companyB: randomUUID(),
  admin: randomUUID(), employee: randomUUID(), adminB: randomUUID(), ownEmployee: randomUUID(),
};
const suffix = randomUUID().slice(0, 8);
const password = `PeopleFlow-test-${randomBytes(18).toString('base64url')}`;
const tenantSlugA = `docs-a-${suffix}`;
const tenantSlugB = `docs-b-${suffix}`;
const origin = 'http://localhost:3000';
const base = '/api/v1';
const downloadSecret = randomBytes(32).toString('base64');

let app: INestApplication;
let adminDatabase: PrismaClient;
let runtimeDatabase: PrismaClient;
let clients: { admin: TestClient; employee: TestClient; adminB: TestClient };
const uploadedStorage: Array<{ key: string; bytes: number }> = [];

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

function upload(path: string, client: TestClient, fileName: string, content: Buffer, fields: Record<string, string> = {}) {
  const req = request(app.getHttpServer()).post(`${base}${path}`).set('Cookie', client.cookies).set('Origin', origin).set('x-csrf-token', client.csrf).attach('file', content, fileName);
  for (const [key, value] of Object.entries(fields)) req.field(key, value);
  return req;
}

async function login(email: string, companySlug = 'primary', tenantSlug = tenantSlugA): Promise<TestClient> {
  const client: TestClient = { cookies: [], csrf: '' };
  const csrf = await request(app.getHttpServer()).get(`${base}/auth/csrf`).expect(200);
  absorbCookies(client, csrf);
  client.csrf = csrf.body.csrfToken;
  const loggedIn = await mutate('post', '/auth/login', client, { tenantSlug, companySlug, email, password }).expect(200);
  absorbCookies(client, loggedIn);
  return client;
}

class MemoryStorage extends StorageAdapter {
  readonly provider = 'SUPABASE' as const;
  constructor(private readonly sink: Array<{ key: string; bytes: number }>) { super(); }
  async upload(input: { tenantId: string; companyId: string; fileName: string; contentType: string; body: Buffer }) {
    const objectKey = this.buildObjectKey(input.tenantId, input.companyId, input.fileName);
    this.sink.push({ key: objectKey, bytes: input.body.byteLength });
    return { provider: this.provider, bucket: 'memory-test', objectKey, sizeBytes: BigInt(input.body.byteLength), sha256: createHash('sha256').update(input.body).digest('hex') };
  }
  async createDownloadUrl(stored: { provider: 'SUPABASE' | 'S3'; bucket: string; objectKey: string }) {
    return { url: `https://memory.test/${stored.objectKey}?sig=${randomBytes(8).toString('hex')}`, expiresAt: new Date(Date.now() + 300_000) };
  }
  async deleteObject() { /* noop */ }
}

beforeAll(async () => {
  const runtime = requireTestDatabase(runtimeUrl, 'TEST_DATABASE_URL');
  const admin = requireTestDatabase(adminUrl, 'TEST_DATABASE_ADMIN_URL');
  if (new URL(runtime).pathname !== new URL(admin).pathname || new URL(runtime).host !== new URL(admin).host) throw new Error('Test admin and runtime must target the same database.');
  if (!redisUrl || !['redis:', 'rediss:'].includes(new URL(redisUrl).protocol) || !/^\/(?:[1-9]|1[0-5])$/.test(new URL(redisUrl).pathname)) throw new Error('TEST_REDIS_URL must use a dedicated nonzero Redis database.');
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = runtime;
  process.env.REDIS_URL = redisUrl;
  process.env.REDIS_PREFIX = `peopleflow-docs-${suffix}`;
  process.env.WEB_ORIGIN = origin;
  process.env.JWT_SECRET = randomBytes(48).toString('base64url');
  process.env.DATA_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.RATE_LIMIT_MAX = '500';
  process.env.RATE_LIMIT_LOGIN_MAX = '500';
  process.env.STORAGE_PROVIDER = 'SUPABASE';
  process.env.STORAGE_BUCKET = 'memory-test';
  process.env.SUPABASE_URL = 'https://memory.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = `service-role-${randomBytes(24).toString('hex')}`;
  process.env.DOWNLOAD_TOKEN_SECRET = downloadSecret;

  adminDatabase = new PrismaClient({ adapter: new PrismaPg({ connectionString: admin }) });
  runtimeDatabase = new PrismaClient({ adapter: new PrismaPg({ connectionString: runtime }) });
  await Promise.all([adminDatabase.$connect(), runtimeDatabase.$connect()]);
  const hash = await argon2.hash(password);
  await adminDatabase.tenant.createMany({ data: [{ id: ids.tenantA, slug: tenantSlugA, name: 'Docs Tenant A' }, { id: ids.tenantB, slug: tenantSlugB, name: 'Docs Tenant B' }] });
  await adminDatabase.company.createMany({ data: [
    { id: ids.companyA, tenantId: ids.tenantA, slug: 'primary', name: 'Docs Company A' },
    { id: ids.companyB, tenantId: ids.tenantB, slug: 'primary', name: 'Docs Company B' },
  ] });
  const user = (id: string, email: string, role: Role, tenantId = ids.tenantA, companyId = ids.companyA) => ({ id, tenantId, companyId, email, name: 'Pessoa de teste', passwordHash: hash, role });
  await adminDatabase.user.createMany({ data: [
    user(ids.admin, 'admin@example.test', 'ADMIN'), user(ids.employee, 'employee@example.test', 'EMPLOYEE'),
    user(ids.adminB, 'admin@example.test', 'ADMIN', ids.tenantB, ids.companyB),
  ] });
  await adminDatabase.employee.createMany({ data: [
    { id: ids.ownEmployee, tenantId: ids.tenantA, companyId: ids.companyA, registration: 'F001', fullName: 'Ana Pessoa', jobTitle: 'Analista', departmentName: 'Operações', hiredAt: new Date('2026-01-01T00:00:00Z'), status: 'ACTIVE', userId: ids.employee },
  ] });

  // Boot through the testing module to override the storage port with an
  // in-memory double; every other wiring matches createApp().
  const { Test } = await import('@nestjs/testing');
  const { AppModule } = await import('../../src/app.module');
  const { SafeErrorFilter } = await import('../../src/common/error.filter');
  const cookieParser = (await import('cookie-parser')).default;
  const { json } = await import('express');
  const helmet = (await import('helmet')).default;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(StorageAdapter).useValue(new MemoryStorage(uploadedStorage))
    .compile();
  app = moduleRef.createNestApplication({ logger: false, bodyParser: false });
  app.setGlobalPrefix('api/v1');
  app.use(helmet({ frameguard: { action: 'deny' } }));
  app.use(json({ limit: '64kb', strict: true }));
  app.use(cookieParser());
  app.useGlobalFilters(new SafeErrorFilter());
  await app.init();

  clients = {
    admin: await login('admin@example.test'),
    employee: await login('employee@example.test'),
    adminB: await login('admin@example.test', 'primary', tenantSlugB),
  };
}, 120_000);

afterAll(async () => {
  await app?.close();
  await runtimeDatabase?.$disconnect();
  if (adminDatabase) {
    const where = { tenantId: { in: [ids.tenantA, ids.tenantB] } };
    await adminDatabase.$transaction(async (tx) => {
      await tx.documentSignature.deleteMany({ where });
      await tx.document.updateMany({ where, data: { currentVersionId: null } });
      await tx.documentVersion.deleteMany({ where });
      await tx.document.deleteMany({ where });
      await tx.documentTemplate.deleteMany({ where });
      await tx.fileObject.deleteMany({ where });
      await tx.auditLog.deleteMany({ where });
      await tx.authSession.deleteMany({ where });
      await tx.employee.deleteMany({ where });
      await tx.user.deleteMany({ where });
      await tx.company.deleteMany({ where });
      await tx.tenant.deleteMany({ where: { id: { in: [ids.tenantA, ids.tenantB] } } });
    });
    await adminDatabase.$disconnect();
  }
}, 60_000);

describe('Stage 2 documents: RLS isolation, versioning, signatures and download tokens', { timeout: 30_000 }, () => {
  let documentId: string;
  let signatureId: string;
  let versionFileId: string;
  let downloadToken: string;

  it('protects the five stage-2 tables with enabled+forced RLS', async () => {
    const tables = await runtimeDatabase.$queryRaw<Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>>`SELECT relname::text, relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname IN ('file_objects', 'document_templates', 'documents', 'document_versions', 'document_signatures') ORDER BY relname`;
    expect(tables.map((t) => t.relname)).toEqual(['document_signatures', 'document_templates', 'document_versions', 'documents', 'file_objects']);
    expect(tables.every((t) => t.relrowsecurity && t.relforcerowsecurity)).toBe(true);
    // fails closed without context
    expect(await runtimeDatabase.$queryRaw`SELECT id FROM documents`).toEqual([]);
  });

  it('creates template, document, versions and a pending signature inside scope A', async () => {
    const template = await mutate('post', '/documents/templates', clients.admin, { code: 'CONTRACT_STD', name: 'Contrato padrão', kind: 'CONTRACT', defaultFileName: 'contrato.pdf' }).expect(201);
    expect(template.body).not.toHaveProperty('tenantId');
    expect(template.body).not.toHaveProperty('companyId');

    const created = await mutate('post', '/documents', clients.admin, { title: 'Contrato de Ana', kind: 'CONTRACT', employeeId: ids.ownEmployee, templateId: template.body.id }).expect(201);
    documentId = created.body.id;
    expect(created.body.status).toBe('DRAFT');

    const pdf = Buffer.from('%PDF-1.4 fake contract content for tests');
    const version = await upload(`/documents/${documentId}/versions`, clients.admin, 'contrato.pdf', pdf, { note: 'versão inicial' }).expect(201);
    expect(version.body.versionNumber).toBe(1);

    const second = await upload(`/documents/${documentId}/versions`, clients.admin, 'contrato-v2.pdf', Buffer.from('%PDF-1.4 revised')).expect(201);
    expect(second.body.versionNumber).toBe(2);

    const detail = await get(`/documents/${documentId}`, clients.admin).expect(200);
    expect(detail.body.currentVersion.versionNumber).toBe(2);
    expect(detail.body.versions.map((v: { versionNumber: number }) => v.versionNumber)).toEqual([1, 2]);

    const signed = await mutate('post', `/documents/${documentId}/signatures`, clients.admin, { role: 'EMPLOYEE', signerUserId: ids.employee }).expect(201);
    signatureId = signed.body.id;
    expect(signed.body).toMatchObject({ role: 'EMPLOYEE', status: 'PENDING', signerName: 'Ana Pessoa' });

    // uploads reached the storage double scoped to company A
    expect(uploadedStorage.length).toBe(2);
    expect(uploadedStorage.every((entry) => entry.key.includes(`companies/${ids.companyA}/`))).toBe(true);
  });

  it('company B cannot read, list or download anything from company A', async () => {
    const list = await get('/documents', clients.adminB).expect(200);
    expect(list.body.items).toEqual([]);
    await get(`/documents/${documentId}`, clients.adminB).expect(404);
    await get(`/documents/${documentId}/download-url`, clients.adminB).expect(404);
    await get(`/documents/${documentId}/signatures`, clients.adminB).expect(404);
    await mutate('post', `/documents/${documentId}/signatures`, clients.adminB, { role: 'WITNESS', signerName: 'Intruso' }).expect(404);
    const templates = await get('/documents/templates', clients.adminB).expect(200);
    expect(templates.body.items).toEqual([]);
  });

  it('rejects direct cross-scope INSERT through RLS WITH CHECK', async () => {
    await expect(runtimeDatabase.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ids.tenantA}, true), set_config('app.company_id', ${ids.companyA}, true)`;
      await tx.document.create({ data: { tenantId: ids.tenantA, companyId: ids.companyB, title: 'Forjado', kind: 'CONTRACT', status: 'DRAFT' } });
    })).rejects.toThrow(/row-level security policy/i);
    await expect(runtimeDatabase.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ids.tenantA}, true), set_config('app.company_id', ${ids.companyA}, true)`;
      await tx.$executeRaw`INSERT INTO file_objects (id, tenant_id, company_id, provider, bucket, object_key, original_name, content_type, size_bytes, sha256, uploaded_by_id) VALUES (${randomUUID()}::uuid, ${ids.tenantA}::uuid, ${ids.companyB}::uuid, 'SUPABASE', 'b', 'k', 'f.pdf', 'application/pdf', 1, ${'0'.repeat(64)}, ${ids.admin}::uuid)`;
    })).rejects.toThrow(/row-level security policy/i);
  });

  it('audits the workflow actions append-only', async () => {
    const logs = await adminDatabase.auditLog.findMany({ where: { tenantId: ids.tenantA, companyId: ids.companyA, action: { startsWith: 'document' } }, orderBy: { createdAt: 'asc' } });
    const actions = logs.map((log) => log.action);
    expect(actions).toContain('document.template_created');
    expect(actions).toContain('document.created');
    expect(actions.filter((a) => a === 'document.version_uploaded')).toHaveLength(2);
    expect(actions).toContain('document_signature.pending');
  });

  it('enforces composite uniques on (document, versionNumber) and (version, fileObject)', async () => {
    const versionRow = await adminDatabase.documentVersion.findFirstOrThrow({ where: { tenantId: ids.tenantA, companyId: ids.companyA, documentId, versionNumber: 2 } });
    versionFileId = versionRow.fileObjectId;
    await expect(runtimeDatabase.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ids.tenantA}, true), set_config('app.company_id', ${ids.companyA}, true)`;
      await tx.$executeRaw`INSERT INTO document_versions (id, tenant_id, company_id, document_id, version_number, file_object_id, created_by) VALUES (${randomUUID()}::uuid, ${ids.tenantA}::uuid, ${ids.companyA}::uuid, ${documentId}::uuid, 2, ${randomUUID()}::uuid, ${ids.admin}::uuid)`;
    })).rejects.toThrow(/duplicate key value|unique/i);
    await expect(runtimeDatabase.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${ids.tenantA}, true), set_config('app.company_id', ${ids.companyA}, true)`;
      await tx.$executeRaw`INSERT INTO document_versions (id, tenant_id, company_id, document_id, version_number, file_object_id, created_by) VALUES (${randomUUID()}::uuid, ${ids.tenantA}::uuid, ${ids.companyA}::uuid, ${randomUUID()}::uuid, 1, ${versionFileId}::uuid, ${ids.admin}::uuid)`;
    })).rejects.toThrow(/duplicate key value|unique/i);
  });

  it('EMPLOYEE sees and downloads only their own document; staff writes are gated', async () => {
    const mine = await get('/documents', clients.employee).expect(200);
    expect(mine.body.items.map((item: { id: string }) => item.id)).toEqual([documentId]);
    const otherDoc = await mutate('post', '/documents', clients.admin, { title: 'Contrato de outro', kind: 'OTHER' }).expect(201);
    await get(`/documents/${otherDoc.body.id}`, clients.employee).expect(404);
    await get(`/documents/${otherDoc.body.id}/download-url`, clients.employee).expect(404);
    await mutate('post', '/documents', clients.employee, { title: 'Tentativa', kind: 'OTHER' }).expect(403);
    await upload(`/documents/${documentId}/versions`, clients.employee, 'x.pdf', Buffer.from('%PDF fake')).expect(403);

    const signUrl = await get(`/documents/${documentId}/download-url`, clients.employee).expect(200);
    downloadToken = signUrl.body.token;
    expect(signUrl.body.url).toContain('memory.test');

    const manual = await mutate('post', `/documents/signatures/${signatureId}/sign`, clients.admin, { evidence: { ip: '203.0.113.9', userAgent: 'manual-test' } }).expect(200);
    expect(manual.body.status).toBe('SIGNED');
    expect(manual.body.evidence).toMatchObject({ method: 'manual' });
    // duplicate (version, role, signerName) is rejected by the composite unique
    await mutate('post', `/documents/${documentId}/signatures`, clients.admin, { role: 'EMPLOYEE', signerName: 'Ana Pessoa' }).expect(409);
    // already-resolved signature cannot be signed twice
    await mutate('post', `/documents/signatures/${signatureId}/sign`, clients.admin, {}).expect(409);
  });

  it('token download works and rejects remapped/tampered/expired payloads', async () => {
    const ok = await request(app.getHttpServer()).get(`${base}/documents/${documentId}/download`).query({ token: downloadToken }).expect(200);
    expect(ok.body.versionNumber).toBe(2);
    expect(ok.body.fileName).toBe('contrato-v2.pdf');

    const payload = verifyDownloadToken(downloadToken, downloadSecret)!;
    expect(payload.companyId).toBe(ids.companyA);

    // remap: attacker re-signs a token bound to their own company — the file
    // is not visible in that scope, so the route must fail closed (404).
    const remapped = signDownloadToken({ ...payload, companyId: ids.companyB, userId: ids.adminB }, downloadSecret);
    await request(app.getHttpServer()).get(`${base}/documents/${documentId}/download`).query({ token: remapped }).expect(404);
    // tampered mac
    const [v, b, m] = downloadToken.split('.');
    await request(app.getHttpServer()).get(`${base}/documents/${documentId}/download`).query({ token: `${v}.${b}.${m.slice(0, -2)}ff` }).expect(403);
    // expired
    const expired = signDownloadToken({ ...payload, exp: Math.floor(Date.now() / 1000) - 5 }, downloadSecret);
    await request(app.getHttpServer()).get(`${base}/documents/${documentId}/download`).query({ token: expired }).expect(403);
  });

  it('upload whitelist rejects disallowed extensions with 415', async () => {
    await upload(`/documents/${documentId}/versions`, clients.admin, 'malware.exe', Buffer.from('MZ...')).expect(415);
  });
});
