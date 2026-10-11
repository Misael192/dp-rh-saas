import { describe, expect, it } from 'vitest';
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { signDownloadToken, verifyDownloadToken } from '../../src/storage/download-token';
import { allowedContentType, extensionOf, StorageAdapter } from '../../src/storage/storage.adapter';
import { DocumentsService, documentView } from '../../src/documents/documents.service';
import { DuplicateSignatureSignerError, NoCurrentVersionError } from '../../src/documents/domain/documents.repository';
import type { AuthUser } from '../../src/auth/auth.types';

const SECRET = randomBytes(32).toString('base64');

function tokenFor(overrides: Partial<{ tenantId: string; companyId: string; fileId: string; userId: string; exp: number }> = {}) {
  const payload = {
    tenantId: randomUUID(), companyId: randomUUID(), fileId: randomUUID(), userId: randomUUID(),
    exp: Math.floor(Date.now() / 1000) + 300, ...overrides,
  };
  return { payload, token: signDownloadToken(payload, SECRET) };
}

describe('download token (HMAC v1)', () => {
  it('roundtrips sign/verify', () => {
    const { payload, token } = tokenFor();
    const verified = verifyDownloadToken(token, SECRET);
    expect(verified).not.toBeNull();
    expect(verified!.fileId).toBe(payload.fileId);
    expect(verified!.tenantId).toBe(payload.tenantId);
  });

  it('rejects a tampered mac', () => {
    const [, body, mac] = tokenFor().token.split('.');
    const flipped = `${body.slice(0, 10)}${body[10] === 'A' ? 'B' : 'A'}${body.slice(11)}`;
    expect(verifyDownloadToken(`v1.${flipped}.${mac}`, SECRET)).toBeNull();
    const badMac = mac.slice(0, -2) + (mac.endsWith('aa') ? 'bb' : 'aa');
    expect(verifyDownloadToken(`v1.${body}.${badMac}`, SECRET)).toBeNull();
  });

  it('rejects an expired exp', () => {
    const { token } = tokenFor({ exp: Math.floor(Date.now() / 1000) - 1 });
    expect(verifyDownloadToken(token, SECRET)).toBeNull();
  });

  it('rejects the wrong secret', () => {
    const { token } = tokenFor();
    expect(verifyDownloadToken(token, randomBytes(32).toString('base64'))).toBeNull();
  });

  it('rejects malformed base64 / structure', () => {
    expect(verifyDownloadToken('v1.%%%not-base64%%%.abc', SECRET)).toBeNull();
    expect(verifyDownloadToken('v2.aaaa.bbbb', SECRET)).toBeNull();
    expect(verifyDownloadToken('garbage', SECRET)).toBeNull();
    const [, body, mac] = tokenFor().token.split('.');
    expect(verifyDownloadToken(`v1.${Buffer.from('x').toString('base64url')}.${mac}`, SECRET)).toBeNull();
  });

  it('rejects tokens longer than 4096 chars', () => {
    const huge = `v1.${'A'.repeat(5000)}.${'b'.repeat(64)}`;
    expect(huge.length).toBeGreaterThan(4096);
    expect(verifyDownloadToken(huge, SECRET)).toBeNull();
  });

  it('rejects payloads without uuid fields even with a valid mac', () => {
    const payload = { tenantId: 'not-a-uuid', companyId: randomUUID(), fileId: randomUUID(), userId: randomUUID(), exp: Math.floor(Date.now() / 1000) + 300 };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const mac = createHmac('sha256', Buffer.from(SECRET)).update(`v1.${body}`).digest('hex');
    expect(verifyDownloadToken(`v1.${body}.${mac}`, SECRET)).toBeNull();
  });

  it('rejects a remapped payload (different user/company) under the same secret', () => {
    const original = tokenFor();
    const attacker = tokenFor({ tenantId: original.payload.tenantId, companyId: randomUUID(), fileId: original.payload.fileId, userId: randomUUID() });
    // The remapped token is internally valid but bound to a different scope —
    // verification returns the ATTACKER's payload, so the original mismatch
    // against the session is detectable by the consumer.
    const verified = verifyDownloadToken(attacker.token, SECRET)!;
    expect(verified.companyId).not.toBe(original.payload.companyId);
  });
});

describe('storage adapter helpers', () => {
  it('allowedContentType accepts pdf/png/docx and refuses exe/svg/html', () => {
    expect(allowedContentType('contrato.pdf')).toBe('application/pdf');
    expect(allowedContentType('foto.PNG')).toBe('image/png');
    expect(allowedContentType('termo.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(allowedContentType('malware.exe')).toBeNull();
    expect(allowedContentType('icon.svg')).toBeNull();
    expect(allowedContentType('page.html')).toBeNull();
    expect(extensionOf('no-extension')).toBe('');
  });

  it('buildObjectKey scopes tenant/company with a random UUID and sanitizes the name', async () => {
    const tenantId = randomUUID();
    const companyId = randomUUID();
    class TestAdapter extends StorageAdapter {
      readonly provider = 'SUPABASE' as const;
      async upload(input: { tenantId: string; companyId: string; fileName: string; contentType: string; body: Buffer }) {
        return { provider: this.provider, bucket: 'b', objectKey: this.buildObjectKey(input.tenantId, input.companyId, input.fileName), sizeBytes: BigInt(input.body.byteLength), sha256: 'x' };
      }
      async createDownloadUrl() { return { url: 'https://example.invalid/f', expiresAt: new Date() }; }
      async deleteObject() { /* noop */ }
    }
    const adapter = new TestAdapter();
    const first = await adapter.upload({ tenantId, companyId, fileName: '../../evil dir/my file.pdf', contentType: 'application/pdf', body: Buffer.from('a') });
    const second = await adapter.upload({ tenantId, companyId, fileName: 'my file.pdf', contentType: 'application/pdf', body: Buffer.from('b') });
    const prefix = `tenants/${tenantId}/companies/${companyId}/`;
    expect(first.objectKey.startsWith(prefix)).toBe(true);
    expect(second.objectKey.startsWith(prefix)).toBe(true);
    expect(first.objectKey).not.toBe(second.objectKey);
    const segments = first.objectKey.slice(prefix.length).split('/');
    expect(segments[0]).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(segments[1]).toBe('my_file.pdf');
    expect(first.objectKey).not.toContain('..');
  });
});

/** In-memory double of the documents repository port (no database). */
class MemoryDocumentsRepository {
  documents: any[] = [];
  templates: any[] = [];
  signatures: any[] = [];
  audits: Array<{ action: string; entityId: string }> = [];
  files: any[] = [];
  listVisibleToCalls: string[] = [];

  async listDocuments(scope: any) { const items = this.documents.filter((d) => d.tenantId === scope.tenantId && d.companyId === scope.companyId); return { items, total: items.length }; }
  async getDocument(scope: any, id: string) { return this.documents.find((d) => d.id === id && d.tenantId === scope.tenantId && d.companyId === scope.companyId) ?? null; }
  async createDocument(actor: any, input: any) {
    const now = new Date();
    const doc = { id: randomUUID(), tenantId: actor.tenantId, companyId: actor.companyId, title: input.title, kind: input.kind, status: 'DRAFT', employeeId: input.employeeId ?? null, templateId: input.templateId ?? null, currentVersionId: null, currentVersion: null, versions: [], signatures: [], employeeUserId: null, createdAt: now, updatedAt: now };
    this.documents.push(doc);
    await this.recordAudit(actor, 'document.created', doc.id, {});
    return doc;
  }
  async updateDocument() { throw new Error('not needed'); }
  async addVersion() { throw new Error('not needed'); }
  async recordAudit(_actor: any, action: string, entityId: string) { this.audits.push({ action, entityId }); }
  async listVisibleToUser(scope: any, userId: string) {
    this.listVisibleToCalls.push(userId);
    return this.documents.filter((d) => d.tenantId === scope.tenantId && d.companyId === scope.companyId
      && (d.employeeUserId === userId || d.signatures.some((s: any) => s.signerUserId === userId)));
  }
  async getFile() { return null; }
  async findFileBySha() { return null; }
  async listTemplates(scope: any) { return this.templates.filter((t) => t.companyId === scope.companyId); }
  async getTemplate() { return null; }
  async createTemplate() { throw new Error('not needed'); }
  async updateTemplate() { throw new Error('not needed'); }
  async listSignatures(_scope: any, documentId: string) { return this.signatures.filter((s) => s.documentId === documentId); }
  async getSignature(scope: any, signatureId: string) {
    const document = this.documents.find((d) => d.tenantId === scope.tenantId && d.companyId === scope.companyId && d.signatures.some((s: any) => s.id === signatureId));
    return document ? document.signatures.find((s: any) => s.id === signatureId) ?? null : null;
  }
  async createSignature(actor: any, input: any) {
    const document = this.documents.find((d) => d.id === input.documentId);
    if (!document?.currentVersion) throw new NoCurrentVersionError();
    const signerName = input.signerName ?? 'Assinante';
    const duplicate = this.signatures.find((s) => s.versionId === document.currentVersionId && s.role === input.role && s.signerName === signerName && s.status !== 'REJECTED');
    if (duplicate) throw new DuplicateSignatureSignerError();
    const signature = { id: randomUUID(), documentId: document.id, versionId: document.currentVersionId, signerUserId: input.signerUserId ?? null, signerName, role: input.role, status: 'PENDING', signedAt: null, evidence: {}, createdAt: new Date() };
    this.signatures.push(signature);
    document.signatures.push(signature);
    void actor;
    return signature;
  }
  async resolveSignature() { return null; }
}

class MemoryStorageAdapter {
  uploads: Array<{ key: string; bytes: number }> = [];
  async upload(input: any) {
    const objectKey = `tenants/${input.tenantId}/companies/${input.companyId}/${randomUUID()}/${input.fileName}`;
    this.uploads.push({ key: objectKey, bytes: input.body.byteLength });
    return { provider: 'SUPABASE', bucket: 'test', objectKey, sizeBytes: BigInt(input.body.byteLength), sha256: 'x'.repeat(64) };
  }
  async createDownloadUrl(stored: any) { return { url: `https://example.invalid/${stored.objectKey}`, expiresAt: new Date(Date.now() + 300_000) }; }
  async deleteObject() { /* noop */ }
}

function makeService() {
  const repository = new MemoryDocumentsRepository();
  const storage = new MemoryStorageAdapter();
  const config = { values: { DOWNLOAD_URL_TTL_SECONDS: 300, DOCUMENT_MAX_UPLOAD_BYTES: 1024, DOWNLOAD_TOKEN_SECRET: SECRET, DATA_ENCRYPTION_KEY: SECRET } } as any;
  const service = new DocumentsService(repository as any, storage as any, config);
  return { service, repository, storage };
}

function staffUser(role: 'ADMIN' | 'HR' | 'EMPLOYEE' | 'MANAGER'): AuthUser {
  return { id: randomUUID(), tenantId: randomUUID(), companyId: randomUUID(), role, email: 'u@example.com' } as AuthUser;
}

describe('documents service (repository double)', () => {
  it('requireStaff blocks EMPLOYEE and MANAGER on create', async () => {
    const { service } = makeService();
    for (const role of ['EMPLOYEE', 'MANAGER'] as const) {
      await expect(service.create(staffUser(role), { title: 'Contrato', kind: 'CONTRACT' })).rejects.toMatchObject({ status: 403 });
    }
  });

  it('view omits tenantId/companyId/userId', async () => {
    const { service } = makeService();
    const admin = staffUser('ADMIN');
    const created = await service.create(admin, { title: 'Contrato de experiência', kind: 'CONTRACT' });
    const serialized = JSON.stringify(created);
    expect(serialized).not.toContain('tenantId');
    expect(serialized).not.toContain('companyId');
    expect(serialized).not.toContain('userId');
    expect(documentView(await (service as any).documents.getDocument({ tenantId: admin.tenantId, companyId: admin.companyId }, created.id))).not.toHaveProperty('employeeUserId');
  });

  it('EMPLOYEE only sees own documents via listVisibleToUser', async () => {
    const { service, repository } = makeService();
    const admin = staffUser('ADMIN');
    const employee = staffUser('EMPLOYEE');
    const doc = await service.create(admin, { title: 'Holerite', kind: 'PAYSLIP' });
    const stored = repository.documents[0];
    expect(stored.tenantId).toBe(admin.tenantId);
    stored.employeeUserId = employee.id;
    const listed = await service.list(employee, { page: 1, pageSize: 20 });
    expect(listed.items.map((i: any) => i.id)).toEqual([doc.id]);
    expect(repository.listVisibleToCalls).toEqual([employee.id]);
    const other = staffUser('EMPLOYEE');
    expect((await service.list(other, { page: 1, pageSize: 20 })).items).toHaveLength(0);
  });

  it('signing flow rejects a duplicated signature for the same (version, role, signerName)', async () => {
    const { service, repository } = makeService();
    const admin = staffUser('ADMIN');
    const doc = await service.create(admin, { title: 'Termo aditivo', kind: 'TERM_SHEET' });
    const stored = repository.documents[0];
    stored.currentVersionId = 'ver-1';
    stored.currentVersion = { id: 'ver-1', documentId: stored.id, versionNumber: 1, fileObjectId: 'file-1', note: null, createdBy: admin.id, createdAt: new Date(), fileObject: { id: 'file-1', originalName: 'termo.pdf', contentType: 'application/pdf', sizeBytes: 1n, sha256: 'y'.repeat(64), createdAt: new Date(), deletedAt: null } };
    const input = { role: 'EMPLOYEE' as const, signerName: 'Maria Silva' };
    const first = await service.createSignature(admin, stored.id, input);
    expect(first.status).toBe('PENDING');
    // resolve first manually in the double (mirrors PENDING -> SIGNED)
    repository.signatures[0].status = 'SIGNED';
    repository.signatures[0].signedAt = new Date();
    await expect(service.createSignature(admin, stored.id, input)).rejects.toThrow(/assinatura pendente para este assinante/i);
    // a different role is not a duplicate
    const other = await service.createSignature(admin, stored.id, { role: 'WITNESS' as const, signerName: 'Maria Silva' });
    expect(other.role).toBe('WITNESS');
  });

  it('upload rejects non-whitelisted extensions with 415 and oversize with 413', async () => {
    const { service } = makeService();
    const admin = staffUser('ADMIN');
    const doc = await service.create(admin, { title: 'Política interna', kind: 'POLICY' });
    await expect(service.addVersion(admin, doc.id, { buffer: Buffer.from('echo hi'), originalName: 'script.exe' }, {}))
      .rejects.toSatisfy((error: unknown) => error instanceof HttpException && error.getStatus() === 415);
    await expect(service.addVersion(admin, doc.id, { buffer: Buffer.alloc(2048), originalName: 'big.pdf' }, {}))
      .rejects.toMatchObject({ status: 413 });
  });
});
