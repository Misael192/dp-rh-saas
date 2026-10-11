import type {
  AddVersionInput, CreateDocumentInput, CreateSignatureInput, CreateTemplateInput,
  DocumentQuery, UpdateDocumentInput, UpdateTemplateInput,
} from '../document.schemas';

export type DocumentKind = 'CONTRACT' | 'TERM_SHEET' | 'POLICY' | 'PAYSLIP' | 'DECLARATION' | 'OTHER';
export type DocumentStatus = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
export type SignatureRole = 'EMPLOYEE' | 'EMPLOYER' | 'WITNESS';
export type SignatureStatus = 'PENDING' | 'SIGNED' | 'REJECTED';
export type StorageProviderName = 'SUPABASE' | 'S3';

export interface CompanyScope { tenantId: string; companyId: string; }
export interface DocumentActor extends CompanyScope { id: string; }

export interface FileObjectRecord {
  id: string; provider: StorageProviderName; bucket: string; objectKey: string;
  originalName: string; contentType: string; sizeBytes: bigint; sha256: string;
  deletedAt: Date | null; createdAt: Date;
}

export interface SignatureRecord {
  id: string; documentId: string; versionId: string; signerUserId: string | null;
  signerName: string; role: SignatureRole; status: SignatureStatus;
  signedAt: Date | null; evidence: Record<string, unknown>; createdAt: Date;
}

export interface DocumentVersionRecord {
  id: string; documentId: string; versionNumber: number; fileObjectId: string;
  note: string | null; createdBy: string | null; createdAt: Date;
  fileObject?: FileObjectRecord;
}

export interface DocumentRecord {
  id: string; employeeId: string | null; templateId: string | null; title: string;
  kind: DocumentKind; status: DocumentStatus; currentVersionId: string | null;
  createdAt: Date; updatedAt: Date;
  /** Linked platform user (employees.user_id) — used for the EMPLOYEE self-scope gate. */
  employeeUserId?: string | null;
  currentVersion?: DocumentVersionRecord | null;
  versions?: DocumentVersionRecord[];
  signatures?: SignatureRecord[];
}

export interface DocumentTemplateRecord {
  id: string; code: string; name: string; kind: DocumentKind; description: string | null;
  defaultFileName: string; isActive: boolean; createdAt: Date; updatedAt: Date;
}

export interface DocumentPage { items: DocumentRecord[]; total: number; }

export class DuplicateTemplateCodeError extends Error {}
export class DuplicateSignatureSignerError extends Error {}

/**
 * Application port for digital documents. Every operation requires explicit
 * tenant AND company context; the implementation must run inside
 * DatabaseService.withScope so RLS enforces the boundary in PostgreSQL.
 */
export abstract class DocumentsRepository {
  abstract listDocuments(scope: CompanyScope, query: DocumentQuery): Promise<DocumentPage>;
  abstract getDocument(scope: CompanyScope, id: string, includeVersions?: boolean): Promise<DocumentRecord | null>;
  abstract createDocument(actor: DocumentActor, input: CreateDocumentInput): Promise<DocumentRecord>;
  abstract updateDocument(actor: DocumentActor, id: string, input: UpdateDocumentInput): Promise<DocumentRecord | null>;
  /** Persists an already-uploaded file row plus the new version and moves the current pointer. */
  abstract addVersion(actor: DocumentActor, documentId: string, file: NewFileInput, input: AddVersionInput): Promise<DocumentVersionRecord>;
  /** Append-only audit trail written inside the repository scope (never trusts client metadata). */
  abstract recordAudit(actor: DocumentActor, action: string, entityId: string, metadata: Record<string, unknown>): Promise<void>;
  /** Documents visible to a non-staff user: own employee documents plus pending signatures. */
  abstract listVisibleToUser(scope: CompanyScope, userId: string): Promise<DocumentRecord[]>;
  abstract getFile(scope: CompanyScope, fileId: string): Promise<FileObjectRecord | null>;
  abstract findFileBySha(scope: CompanyScope, sha256: string): Promise<FileObjectRecord | null>;
  abstract listTemplates(scope: CompanyScope, kind?: DocumentKind): Promise<DocumentTemplateRecord[]>;
  abstract getTemplate(scope: CompanyScope, id: string): Promise<DocumentTemplateRecord | null>;
  abstract createTemplate(actor: DocumentActor, input: CreateTemplateInput): Promise<DocumentTemplateRecord>;
  abstract updateTemplate(actor: DocumentActor, id: string, input: UpdateTemplateInput): Promise<DocumentTemplateRecord | null>;
  abstract listSignatures(scope: CompanyScope, documentId: string): Promise<SignatureRecord[]>;
  /** Single signature lookup inside the caller scope (ownership gate for manual signing). */
  abstract getSignature(scope: CompanyScope, signatureId: string): Promise<SignatureRecord | null>;
  abstract createSignature(actor: DocumentActor, input: CreateSignatureInput & { documentId: string }): Promise<SignatureRecord>;
  /** Manual signature transition PENDING -> SIGNED|REJECTED, append-only evidence. */
  abstract resolveSignature(actor: DocumentActor, signatureId: string, decision: 'SIGNED' | 'REJECTED', evidence: Record<string, unknown>): Promise<SignatureRecord | null>;
}

export interface NewFileInput {
  provider: StorageProviderName; bucket: string; objectKey: string;
  originalName: string; contentType: string; sizeBytes: bigint; sha256: string;
}
