import { z } from 'zod';

/** Shared Stage 2 contracts — API responses consumed by the web workspace. */

export const documentKindSchema = z.enum(['CONTRACT','TERM_SHEET','POLICY','PAYSLIP','DECLARATION','OTHER']);
export const documentStatusSchema = z.enum(['DRAFT','PUBLISHED','ARCHIVED']);
export const signatureRoleSchema = z.enum(['EMPLOYEE','EMPLOYER','WITNESS']);
export const signatureStatusSchema = z.enum(['PENDING','SIGNED','REJECTED']);

export type DocumentKind = z.infer<typeof documentKindSchema>;
export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export type SignatureRole = z.infer<typeof signatureRoleSchema>;
export type SignatureStatus = z.infer<typeof signatureStatusSchema>;

export interface FileSummary {
  id: string; fileName: string; contentType: string; sizeBytes: number; sha256: string; uploadedAt: string;
}

export interface SignatureView {
  id: string; versionId: string; signerName: string; role: SignatureRole; status: SignatureStatus;
  signedAt: string | null; evidence: Record<string, unknown>; createdAt: string;
}

export interface VersionView {
  id: string; versionNumber: number; note: string | null; createdAt: string;
  file: FileSummary | null; signatures?: SignatureView[];
}

export interface DocumentView {
  id: string; title: string; kind: DocumentKind; status: DocumentStatus;
  employeeId: string | null; templateId: string | null;
  currentVersion: VersionView | null; versions?: VersionView[]; signatures?: SignatureView[];
  createdAt: string; updatedAt: string;
}

export interface TemplateView {
  id: string; code: string; name: string; kind: DocumentKind; description: string | null;
  defaultFileName: string; isActive: boolean; createdAt: string; updatedAt: string;
}

export interface DownloadUrlView {
  url: string; expiresAt: string; token: string; fileName: string; versionNumber: number;
}

export interface DocumentCreateInput {
  title: string; kind: DocumentKind; employeeId?: string | null; templateId?: string | null;
}

export interface TemplateCreateInput {
  code: string; name: string; kind: DocumentKind; description?: string | null; defaultFileName: string;
}

export interface SignatureCreateInput { role: SignatureRole; signerName: string; signerUserId?: string; }
