import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/database.service';
import type {
  AddVersionInput, CreateDocumentInput, CreateSignatureInput, CreateTemplateInput,
  DocumentQuery, UpdateDocumentInput, UpdateTemplateInput,
} from '../document.schemas';
import {
  DocumentRecord, DocumentsRepository, DocumentTemplateRecord, DuplicateSignatureSignerError,
  DuplicateTemplateCodeError, FileObjectRecord, NewFileInput, SignatureRecord,
} from '../domain/documents.repository';

const fileShape = {
  id: true, provider: true, bucket: true, objectKey: true, originalName: true,
  contentType: true, sizeBytes: true, sha256: true, deletedAt: true, createdAt: true,
} satisfies Prisma.FileObjectSelect;

const versionSelect = {
  id: true, documentId: true, versionNumber: true, fileObjectId: true, note: true,
  createdBy: true, createdAt: true, fileObject: { select: fileShape },
} satisfies Prisma.DocumentVersionSelect;

const signatureShape = {
  id: true, documentId: true, versionId: true, signerUserId: true, signerName: true,
  role: true, status: true, signedAt: true, evidence: true, createdAt: true,
} satisfies Prisma.DocumentSignatureSelect;

@Injectable()
export class PrismaDocumentsRepository extends DocumentsRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) { super(); }

  listDocuments(scope: { tenantId: string; companyId: string }, query: DocumentQuery): Promise<{ items: DocumentRecord[]; total: number }> {
    const where: Prisma.DocumentWhereInput = {
      ...scope,
      ...(query.status ? { status: query.status } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      ...(query.q ? { title: { contains: query.q, mode: 'insensitive' as const } } : {}),
    };
    return this.database.withScope(scope, async (tx) => {
      const [items, total] = await Promise.all([
        tx.document.findMany({
          where, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: (query.page - 1) * query.pageSize, take: query.pageSize,
          select: this.documentSelect(),
        }),
        tx.document.count({ where }),
      ]);
      return { items: items as unknown as DocumentRecord[], total };
    });
  }

  /** Shared projection: document + current version (+ file/signatures) + the linked
   * employee's platform user for the EMPLOYEE self-scope gate. */
  private documentSelect() {
    return {
      id: true, employeeId: true, templateId: true, title: true, kind: true, status: true,
      currentVersionId: true, createdAt: true, updatedAt: true,
      employee: { select: { userId: true } },
      currentVersion: { select: { ...versionSelect, signatures: { select: signatureShape } } },
    } satisfies Prisma.DocumentSelect;
  }

  listVisibleToUser(scope: { tenantId: string; companyId: string }, userId: string): Promise<DocumentRecord[]> {
    return this.database.withScope(scope, async (tx) => {
      const employee = await tx.employee.findFirst({ where: { ...scope, userId }, select: { id: true } });
      const documents = await tx.document.findMany({
        where: {
          ...scope,
          OR: [
            ...(employee ? [{ employeeId: employee.id }] : []),
            { signatures: { some: { signerUserId: userId } } },
          ],
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        select: this.documentSelect(),
      });
      return documents.map((document) => ({ ...document, employeeUserId: document.employee?.userId ?? null })) as unknown as DocumentRecord[];
    });
  }

  getDocument(scope: { tenantId: string; companyId: string }, id: string, includeVersions = false): Promise<DocumentRecord | null> {
    return this.database.withScope(scope, (tx) => tx.document.findFirst({
      where: { ...scope, id },
      select: {
        ...this.documentSelect(),
        ...(includeVersions ? { versions: { orderBy: { versionNumber: 'desc' }, select: versionSelect } } : {}),
        signatures: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: signatureShape },
      },
    }).then((document) => (document ? { ...document, employeeUserId: document.employee?.userId ?? null } as unknown as DocumentRecord : null)));
  }

  createDocument(actor: { tenantId: string; companyId: string; id: string }, input: CreateDocumentInput): Promise<DocumentRecord> {
    return this.database.withScope(actor, async (tx) => {
      if (input.employeeId && !await tx.employee.findFirst({ where: { tenantId: actor.tenantId, companyId: actor.companyId, id: input.employeeId }, select: { id: true } })) {
        throw new NotFoundInScopeError('employee');
      }
      if (input.templateId && !await tx.documentTemplate.findFirst({ where: { tenantId: actor.tenantId, companyId: actor.companyId, id: input.templateId, isActive: true }, select: { id: true } })) {
        throw new NotFoundInScopeError('template');
      }
      const document = await tx.document.create({
        data: { tenantId: actor.tenantId, companyId: actor.companyId, title: input.title, kind: input.kind, employeeId: input.employeeId ?? null, templateId: input.templateId ?? null },
        select: {
          id: true, employeeId: true, templateId: true, title: true, kind: true, status: true,
          currentVersionId: true, createdAt: true, updatedAt: true,
        },
      });
      await this.audit(tx, actor, 'document.created', document.id, { kind: input.kind });
      return document as unknown as DocumentRecord;
    });
  }

  recordAudit(actor: { tenantId: string; companyId: string; id: string }, action: string, entityId: string, metadata: Record<string, unknown>): Promise<void> {
    return this.database.withScope(actor, (tx) => this.audit(tx, actor, action, entityId, metadata));
  }

  updateDocument(actor: { tenantId: string; companyId: string; id: string }, id: string, input: UpdateDocumentInput): Promise<DocumentRecord | null> {
    return this.database.withScope(actor, async (tx) => {
      const where = { tenantId: actor.tenantId, companyId: actor.companyId, id };
      const existing = await tx.document.findFirst({ where, select: { id: true, status: true, currentVersionId: true } });
      if (!existing) return null;
      // Publishing requires a current version; archiving is always allowed.
      if (input.status === 'PUBLISHED' && !existing.currentVersionId) throw new PublishWithoutVersionError();
      if (input.employeeId) {
        const found = await tx.employee.findFirst({ where: { tenantId: actor.tenantId, companyId: actor.companyId, id: input.employeeId }, select: { id: true } });
        if (!found) throw new NotFoundInScopeError('employee');
      }
      const document = await tx.document.update({
        where: { tenantId_companyId_id: where },
        data: { ...input },
        select: {
          id: true, employeeId: true, templateId: true, title: true, kind: true, status: true,
          currentVersionId: true, createdAt: true, updatedAt: true,
        },
      });
      await this.audit(tx, actor, 'document.updated', document.id, { fields: Object.keys(input) });
      return document as unknown as DocumentRecord;
    });
  }

  addVersion(actor: { tenantId: string; companyId: string; id: string }, documentId: string, file: NewFileInput, input: AddVersionInput): Promise<any> {
    return this.database.withScope(actor, async (tx) => {
      const document = await tx.document.findFirst({ where: { tenantId: actor.tenantId, companyId: actor.companyId, id: documentId }, select: { id: true, status: true } });
      if (!document) throw new NotFoundInScopeError('document');
      const last = await tx.documentVersion.findFirst({ where: { tenantId: actor.tenantId, companyId: actor.companyId, documentId }, orderBy: { versionNumber: 'desc' }, select: { versionNumber: true } });
      const versionNumber = (last?.versionNumber ?? 0) + 1;
      const fileObject = await tx.fileObject.create({ data: { tenantId: actor.tenantId, companyId: actor.companyId, ...file, uploadedById: actor.id } });
      const version = await tx.documentVersion.create({
        data: { tenantId: actor.tenantId, companyId: actor.companyId, documentId, versionNumber, fileObjectId: fileObject.id, note: input.note ?? null, createdBy: actor.id },
      });
      // Two-step pointer move: the version row must exist before the composite FK on documents resolves.
      const updated = await tx.document.update({
        where: { tenantId_companyId_id: { tenantId: actor.tenantId, companyId: actor.companyId, id: documentId } },
        data: { currentVersionId: version.id },
      });
      if (updated.status === 'PUBLISHED') { /* pointer already moved; published docs keep their state */ }
      return { ...version, fileObject } as any;
    });
  }

  getFile(scope: { tenantId: string; companyId: string }, fileId: string): Promise<FileObjectRecord | null> {
    return this.database.withScope(scope, (tx) => tx.fileObject.findFirst({
      where: { ...scope, id: fileId, deletedAt: null }, select: fileShape,
    }) as Promise<FileObjectRecord | null>);
  }

  findFileBySha(scope: { tenantId: string; companyId: string }, sha256: string): Promise<FileObjectRecord | null> {
    return this.database.withScope(scope, (tx) => tx.fileObject.findFirst({
      where: { ...scope, sha256, deletedAt: null }, select: fileShape, orderBy: { createdAt: 'asc' },
    }) as Promise<FileObjectRecord | null>);
  }

  listTemplates(scope: { tenantId: string; companyId: string }, kind?: any): Promise<DocumentTemplateRecord[]> {
    return this.database.withScope(scope, (tx) => tx.documentTemplate.findMany({
      where: { ...scope, ...(kind ? { kind } : {}) }, orderBy: [{ name: 'asc' }, { id: 'asc' }] ,
    })) as Promise<DocumentTemplateRecord[]>;
  }

  getTemplate(scope: { tenantId: string; companyId: string }, id: string): Promise<DocumentTemplateRecord | null> {
    return this.database.withScope(scope, (tx) => tx.documentTemplate.findFirst({ where: { ...scope, id } })) as Promise<DocumentTemplateRecord | null>;
  }

  createTemplate(actor: { tenantId: string; companyId: string; id: string }, input: CreateTemplateInput): Promise<DocumentTemplateRecord> {
    try {
      return this.database.withScope(actor, async (tx) => {
        const template = await tx.documentTemplate.create({ data: { tenantId: actor.tenantId, companyId: actor.companyId, ...input, description: input.description ?? null } });
        await this.audit(tx, actor, 'document.template_created', template.id, { code: input.code });
        return template as DocumentTemplateRecord;
      });
    } catch (error) { return this.rethrowWriteError(error); }
  }

  updateTemplate(actor: { tenantId: string; companyId: string; id: string }, id: string, input: UpdateTemplateInput): Promise<DocumentTemplateRecord | null> {
    return this.database.withScope(actor, async (tx) => {
      const where = { tenantId: actor.tenantId, companyId: actor.companyId, id };
      if (!await tx.documentTemplate.findFirst({ where, select: { id: true } })) return null;
      const template = await tx.documentTemplate.update({ where: { tenantId_companyId_id: where }, data: { ...input } });
      await this.audit(tx, actor, 'document_template.updated', template.id, { fields: Object.keys(input) });
      return template as DocumentTemplateRecord;
    });
  }

  listSignatures(scope: { tenantId: string; companyId: string }, documentId: string): Promise<SignatureRecord[]> {
    return this.database.withScope(scope, (tx) => tx.documentSignature.findMany({
      where: { ...scope, documentId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], select: signatureShape,
    })) as Promise<SignatureRecord[]>;
  }

  createSignature(actor: { tenantId: string; companyId: string; id: string }, input: CreateSignatureInput & { documentId: string }): Promise<SignatureRecord> {
    const { documentId, ...data } = input;
    try {
      return this.database.withScope(actor, async (tx) => {
        const document = await tx.document.findFirst({
          where: { tenantId: actor.tenantId, companyId: actor.companyId, id: documentId },
          select: { id: true, currentVersionId: true },
        });
        if (!document) throw new NotFoundInScopeError('document');
        if (!document.currentVersionId) throw new NoCurrentVersionError();
        if (data.signerUserId) {
          const signer = await tx.user.findFirst({ where: { tenantId: actor.tenantId, companyId: actor.companyId, id: data.signerUserId, isActive: true }, select: { id: true } });
          if (!signer) throw new NotFoundInScopeError('signer');
        }
        // When signing on behalf of an employee account, the authoritative name is the
        // employee's full name; it takes precedence over any staff-supplied signerName.
        if (data.role === 'EMPLOYEE' && data.signerUserId) {
          const employee = await tx.employee.findFirst({
            where: { tenantId: actor.tenantId, companyId: actor.companyId, userId: data.signerUserId },
            select: { fullName: true },
          });
          if (employee) data.signerName = employee.fullName;
        }
        // Otherwise the staff-provided name wins; when signing on behalf of a platform
        // user without one, the name is taken from that user's record.
        const signerName = data.signerName ?? (data.signerUserId
          ? await tx.user.findFirst({ where: { tenantId: actor.tenantId, companyId: actor.companyId, id: data.signerUserId }, select: { name: true } }).then((user) => user?.name ?? 'Assinante')
          : 'Assinante');
        const signature = await tx.documentSignature.create({
          data: { tenantId: actor.tenantId, companyId: actor.companyId, documentId, versionId: document.currentVersionId, signerName: signerName ?? 'Assinante', role: data.role, signerUserId: data.signerUserId ?? null, evidence: {} },
          select: signatureShape,
        });
        await this.audit(tx, actor, 'document_signature.pending', signature.id, { documentId, role: data.role });
        return signature as unknown as SignatureRecord;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new DuplicateSignatureSignerError();
      throw error;
    }
  }

  getSignature(scope: { tenantId: string; companyId: string }, signatureId: string): Promise<SignatureRecord | null> {
    return this.database.withScope(scope, (tx) => tx.documentSignature.findFirst({
      where: { tenantId: scope.tenantId, companyId: scope.companyId, id: signatureId },
      select: signatureShape,
    }).then((signature) => (signature ? signature as unknown as SignatureRecord : null)));
  }

  resolveSignature(actor: { tenantId: string; companyId: string; id: string }, signatureId: string, decision: 'SIGNED' | 'REJECTED', evidence: Record<string, unknown>): Promise<SignatureRecord | null> {
    return this.database.withScope(actor, async (tx) => {
      const where = { tenantId: actor.tenantId, companyId: actor.companyId, id: signatureId };
      const existing = await tx.documentSignature.findFirst({ where, select: { id: true, status: true, documentId: true } });
      if (!existing) return null;
      if (existing.status !== 'PENDING') throw new SignatureAlreadyResolvedError();
      const signature = await tx.documentSignature.update({
        where: { tenantId_companyId_id: where },
        data: decision === 'SIGNED'
          ? { status: 'SIGNED', signedAt: new Date(), evidence: evidence as Prisma.InputJsonValue }
          : { status: 'REJECTED', evidence: evidence as Prisma.InputJsonValue },
        select: signatureShape,
      });
      await this.audit(tx, actor, decision === 'SIGNED' ? 'document.signed' : 'document_signature.rejected', signature.id, { documentId: existing.documentId });
      return signature as unknown as SignatureRecord;
    });
  }

  private async audit(tx: Prisma.TransactionClient, actor: { tenantId: string; companyId: string; id: string }, action: string, entityId: string, metadata: Record<string, unknown>) {
    await tx.auditLog.create({ data: { tenantId: actor.tenantId, companyId: actor.companyId, userId: actor.id, action, entityId, metadata: metadata as Prisma.InputJsonValue } });
  }

  private rethrowWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new DuplicateTemplateCodeError();
    throw error;
  }
}

/** Domain-level failures translated by the service into HTTP errors. */
export class NotFoundInScopeError extends Error { constructor(readonly entity: string) { super(`${entity} not found in scope`); } }
export class PublishWithoutVersionError extends Error {}
export class NoCurrentVersionError extends Error {}
export class SignatureAlreadyResolvedError extends Error {}
