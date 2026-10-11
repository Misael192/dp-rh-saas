import { createHash } from 'node:crypto';
import { BadRequestException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, InternalServerErrorException, NotFoundException, PayloadTooLargeException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import { AppConfig } from '../common/config';
import { allowedContentType, StorageAdapter } from '../storage/storage.adapter';
import { signDownloadToken, verifyDownloadToken } from '../storage/download-token';
import type {
  AddVersionInput, CreateDocumentInput, CreateSignatureInput, CreateTemplateInput,
  DocumentQuery, UpdateDocumentInput, UpdateTemplateInput,
} from './document.schemas';
import { DocumentsRepository, type DocumentRecord } from './domain/documents.repository';
import {
  NoCurrentVersionError, NotFoundInScopeError, PublishWithoutVersionError, SignatureAlreadyResolvedError,
} from './infrastructure/prisma-documents.repository';
import { DuplicateSignatureSignerError, DuplicateTemplateCodeError } from './domain/documents.repository';

/** Content types the multipart endpoint accepts (extension whitelist from the storage port). */
const ALLOWED_UPLOAD_CONTENT_TYPES = new Set<string>([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
  'text/plain', 'application/rtf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);

/** Public representations never leak tenantId/companyId/userId scoping columns. */
export function fileView(file: { id: string; originalName: string; contentType: string; sizeBytes: bigint; sha256: string; createdAt: Date } | null) {
  if (!file) return null;
  return {
    id: file.id, fileName: file.originalName, contentType: file.contentType,
    sizeBytes: Number(file.sizeBytes), sha256: file.sha256, uploadedAt: file.createdAt.toISOString(),
  };
}

export function signatureView(signature: { id: string; versionId: string; signerName: string; role: string; status: string; signedAt: Date | null; evidence: Record<string, unknown>; createdAt: Date }) {
  return {
    id: signature.id, versionId: signature.versionId, signerName: signature.signerName,
    role: signature.role, status: signature.status,
    signedAt: signature.signedAt ? signature.signedAt.toISOString() : null,
    evidence: signature.evidence, createdAt: signature.createdAt.toISOString(),
  };
}

export function versionView(version: any) {
  if (!version) return null;
  return {
    id: version.id, versionNumber: version.versionNumber, note: version.note ?? null,
    createdAt: version.createdAt.toISOString(), file: fileView(version.fileObject ?? null),
    ...(version.signatures ? { signatures: version.signatures.map(signatureView) } : {}),
  };
}

export function documentView(document: any, options: { includeVersions?: boolean } = {}) {
  return {
    id: document.id, title: document.title, kind: document.kind, status: document.status,
    employeeId: document.employeeId ?? null, templateId: document.templateId ?? null,
    currentVersion: versionView(document.currentVersion ?? null),
    ...(options.includeVersions && Array.isArray(document.versions) ? { versions: document.versions.map(versionView) } : {}),
    ...(Array.isArray(document.signatures) ? { signatures: document.signatures.map(signatureView) } : {}),
    createdAt: document.createdAt.toISOString(), updatedAt: document.updatedAt.toISOString(),
  };
}

export function templateView(template: { id: string; code: string; name: string; kind: string; description: string | null; defaultFileName: string; isActive: boolean; createdAt: Date; updatedAt: Date }) {
  return {
    id: template.id, code: template.code, name: template.name, kind: template.kind,
    description: template.description, defaultFileName: template.defaultFileName,
    isActive: template.isActive, createdAt: template.createdAt.toISOString(), updatedAt: template.updatedAt.toISOString(),
  };
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DocumentsRepository) private readonly documents: DocumentsRepository,
    @Inject(StorageAdapter) private readonly storage: StorageAdapter,
    @Inject(AppConfig) private readonly config: AppConfig,
  ) {}

  private requireStaff(user: AuthUser) {
    if (user.role !== 'ADMIN' && user.role !== 'HR') throw new ForbiddenException('Acesso restrito à administração e ao RH.');
  }

  /** EMPLOYEE/MANAGER may only touch documents of their own employee record or
   * documents where they are a signer. Returns true when the user is staff. */
  private canAccessDocument(user: AuthUser, document: DocumentRecord): boolean {
    if (user.role === 'ADMIN' || user.role === 'HR') return true;
    if (document.employeeUserId && document.employeeUserId === user.id) return true;
    return Boolean(document.signatures?.some((signature) => signature.signerUserId === user.id));
  }

  private scope(user: AuthUser) { return { tenantId: user.tenantId, companyId: user.companyId }; }
  private actor(user: AuthUser) { return { tenantId: user.tenantId, companyId: user.companyId, id: user.id }; }

  async list(user: AuthUser, query: DocumentQuery) {
    if (user.role === 'EMPLOYEE' || user.role === 'MANAGER') {
      const visible = await this.documents.listVisibleToUser(this.scope(user), user.id);
      return { items: visible.map((item) => documentView(item)), total: visible.length, page: 1, pageSize: visible.length };
    }
    const page = await this.documents.listDocuments(this.scope(user), query);
    return { items: page.items.map((item) => documentView(item)), total: page.total, page: query.page, pageSize: query.pageSize };
  }

  async get(user: AuthUser, id: string) {
    const document = await this.documents.getDocument(this.scope(user), id, true);
    if (!document || !this.canAccessDocument(user, document)) throw new NotFoundException('Documento não encontrado.');
    return documentView(document, { includeVersions: true });
  }

  async create(user: AuthUser, input: CreateDocumentInput) {
    this.requireStaff(user);
    try { return documentView(await this.documents.createDocument(this.actor(user), input)); }
    catch (error) { return this.rethrow(error); }
  }

  async update(user: AuthUser, id: string, input: UpdateDocumentInput) {
    this.requireStaff(user);
    try {
      const document = await this.documents.updateDocument(this.actor(user), id, input);
      if (!document) throw new NotFoundException('Documento não encontrado.');
      return documentView(document);
    } catch (error) { return this.rethrow(error); }
  }

  /** Uploads the binary to the configured provider and appends a new immutable version. */
  async addVersion(user: AuthUser, documentId: string, upload: { buffer: Buffer; originalName: string; mimeType?: string }, input: AddVersionInput) {
    this.requireStaff(user);
    const file = this.validateUpload(upload);
    const existing = await this.documents.getDocument(this.scope(user), documentId);
    if (!existing) throw new NotFoundException('Documento não encontrado.');
    if (existing.status === 'ARCHIVED') throw new ConflictException('Documento arquivado não aceita novas versões.');
    // sha256 is computed server-side from the trusted buffer, never from client data.
    const sha256 = createHash('sha256').update(file.buffer).digest('hex');
    const stored = await this.storage.upload({
      tenantId: user.tenantId, companyId: user.companyId,
      fileName: file.originalName, contentType: file.contentType, body: file.buffer,
    }).catch(() => { throw new InternalServerErrorException('Não foi possível armazenar o arquivo. Tente novamente.'); });
    try {
      const version = await this.documents.addVersion(this.actor(user), documentId, {
        provider: stored.provider, bucket: stored.bucket, objectKey: stored.objectKey,
        originalName: file.originalName, contentType: file.contentType,
        sizeBytes: BigInt(stored.sizeBytes), sha256,
      }, input);
      await this.auditVersionUploaded(user, documentId, version);
      return versionView(version);
    } catch (error) {
      // Compensate: remove the orphan object if the transaction could not commit.
      await this.storage.deleteObject({ provider: stored.provider, bucket: stored.bucket, objectKey: stored.objectKey }).catch(() => undefined);
      return this.rethrow(error);
    }
  }

  /** Append-only audit trail for the uploaded version (same scope as the write). */
  private async auditVersionUploaded(actor: AuthUser, documentId: string, version: { id: string; versionNumber: number; fileObjectId?: string }) {
    await this.documents.recordAudit(this.actor(actor), 'document.version_uploaded', documentId, {
      versionId: version.id, versionNumber: version.versionNumber, fileObjectId: version.fileObjectId ?? null,
    });
  }

  /** Signed URL through the provider plus an HMAC capability bound to user+scope+expiry. */
  async downloadUrl(user: AuthUser, documentId: string) {
    const document = await this.documents.getDocument(this.scope(user), documentId);
    if (!document || !this.canAccessDocument(user, document)) throw new NotFoundException('Documento não encontrado.');
    if (!document.currentVersion?.fileObject) throw new NotFoundException('O documento ainda não possui versão publicada.');
    const file = document.currentVersion.fileObject;
    const ttl = this.config.values.DOWNLOAD_URL_TTL_SECONDS;
    const signed = await this.storage.createDownloadUrl(
      { provider: file.provider as 'SUPABASE' | 'S3', bucket: file.bucket, objectKey: file.objectKey },
      { fileName: file.originalName, contentType: file.contentType, ttlSeconds: ttl },
    );
    const secret = this.downloadSecret();
    // Capability binds the file to the company scope and the current version's
    // uploader (never a client-supplied id). A remapped payload fails verification.
    const token = signDownloadToken(
      { tenantId: user.tenantId, companyId: user.companyId, fileId: file.id, userId: document.currentVersion.createdBy ?? user.id, exp: Math.floor(Date.now() / 1000) + ttl },
      secret,
    );
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString(), token, fileName: file.originalName, versionNumber: document.currentVersion.versionNumber };
  }

  /** Token-only download for contexts without a session (e.g. email links). The
   * payload must match the file's owning company scope and its uploader. */
  async downloadUrlForToken(token: string, documentId: string) {
    const secret = this.downloadSecret();
    const payload = verifyDownloadToken(token, secret);
    if (!payload) throw new ForbiddenException('Link de download inválido ou expirado.');
    const scope = { tenantId: payload.tenantId, companyId: payload.companyId };
    const document = await this.documents.getDocument(scope, documentId);
    if (!document) throw new NotFoundException('Documento não encontrado.');
    const version = document.currentVersion;
    const file = version?.fileObject;
    if (!version || !file) throw new NotFoundException('O documento ainda não possui versão publicada.');
    if (file.id !== payload.fileId) throw new ForbiddenException('Link de download não corresponde a este documento.');
    if ((version.createdBy ?? payload.userId) !== payload.userId) throw new ForbiddenException('Link de download não corresponde a este documento.');
    const ttl = this.config.values.DOWNLOAD_URL_TTL_SECONDS;
    const signed = await this.storage.createDownloadUrl(
      { provider: file.provider as 'SUPABASE' | 'S3', bucket: file.bucket, objectKey: file.objectKey },
      { fileName: file.originalName, contentType: file.contentType, ttlSeconds: ttl },
    );
    return { url: signed.url, expiresAt: signed.expiresAt.toISOString(), fileName: file.originalName, versionNumber: version.versionNumber };
  }

  async listTemplates(user: AuthUser, kind?: CreateTemplateInput['kind']) {
    this.requireStaff(user);
    const templates = await this.documents.listTemplates(this.scope(user), kind);
    return { items: templates.map(templateView) };
  }

  async createTemplate(user: AuthUser, input: CreateTemplateInput) {
    this.requireStaff(user);
    try { return templateView(await this.documents.createTemplate(this.actor(user), input)); }
    catch (error) { return this.rethrow(error); }
  }

  async updateTemplate(user: AuthUser, id: string, input: UpdateTemplateInput) {
    this.requireStaff(user);
    try {
      const template = await this.documents.updateTemplate(this.actor(user), id, input);
      if (!template) throw new NotFoundException('Modelo não encontrado.');
      return templateView(template);
    } catch (error) { return this.rethrow(error); }
  }

  async listSignatures(user: AuthUser, documentId: string) {
    this.requireStaff(user);
    const document = await this.documents.getDocument(this.scope(user), documentId);
    if (!document) throw new NotFoundException('Documento não encontrado.');
    const signatures = await this.documents.listSignatures(this.scope(user), documentId);
    return { items: signatures.map(signatureView) };
  }

  async createSignature(user: AuthUser, documentId: string, input: CreateSignatureInput) {
    this.requireStaff(user);
    try { return signatureView(await this.documents.createSignature(this.actor(user), { ...input, documentId })); }
    catch (error) { return this.rethrow(error); }
  }

  /** Manual signature: staff records that a person signed offline/physically. */
  async sign(user: AuthUser, signatureId: string, evidence: Record<string, unknown>) {
    this.requireStaff(user);
    const payload = { ...evidence, recordedBy: 'staff-manual', at: new Date().toISOString() };
    try {
      const signature = await this.documents.resolveSignature(this.actor(user), signatureId, 'SIGNED', payload);
      if (!signature) throw new NotFoundException('Assinatura não encontrada.');
      return signatureView(signature);
    } catch (error) { return this.rethrow(error); }
  }

  async reject(user: AuthUser, signatureId: string, reason: string) {
    this.requireStaff(user);
    try {
      const signature = await this.documents.resolveSignature(this.actor(user), signatureId, 'REJECTED', { reason, at: new Date().toISOString() });
      if (!signature) throw new NotFoundException('Assinatura não encontrada.');
      return signatureView(signature);
    } catch (error) { return this.rethrow(error); }
  }

  private validateUpload(upload: { buffer: Buffer; originalName: string; mimeType?: string }) {
    const originalName = (upload.originalName ?? '').split('/').pop()?.trim() ?? '';
    const contentType = allowedContentType(originalName);
    if (!contentType) throw new HttpException('Tipo de arquivo não permitido. Envie PDF, imagem, texto ou planilha.', 415);
    // Defense in depth: reject mismatched declared MIME before touching storage.
    if (upload.mimeType && upload.mimeType !== 'application/octet-stream' && !ALLOWED_UPLOAD_CONTENT_TYPES.has(upload.mimeType)) {
      throw new HttpException('Tipo MIME não suportado.', 415);
    }
    if (!upload.buffer || upload.buffer.byteLength === 0) throw new BadRequestException('O arquivo está vazio.');
    if (upload.buffer.byteLength > this.config.values.DOCUMENT_MAX_UPLOAD_BYTES) throw new PayloadTooLargeException('Arquivo maior que o limite de upload.');
    return { buffer: upload.buffer, originalName, contentType };
  }

  private downloadSecret(): string {
    const secret = this.config.values.DOWNLOAD_TOKEN_SECRET ?? this.config.values.DATA_ENCRYPTION_KEY;
    if (!secret) throw new InternalServerErrorException('Configuração de download indisponível.');
    return secret;
  }

  private rethrow(error: unknown): never {
    if (error instanceof NotFoundInScopeError) throw new NotFoundException('Registro relacionado não encontrado na empresa atual.');
    if (error instanceof PublishWithoutVersionError) throw new ConflictException('Publique uma versão antes de alterar o documento para publicado.');
    if (error instanceof NoCurrentVersionError) throw new ConflictException('O documento precisa de uma versão antes de receber assinaturas.');
    if (error instanceof SignatureAlreadyResolvedError) throw new ConflictException('Esta assinatura já foi registrada.');
    if (error instanceof DuplicateTemplateCodeError) throw new ConflictException('Já existe um modelo com este código nesta empresa.');
    if (error instanceof DuplicateSignatureSignerError) throw new ConflictException('Já existe uma assinatura pendente para este assinante nesta versão.');
    throw error;
  }
}
