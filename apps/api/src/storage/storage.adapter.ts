import { randomUUID } from 'node:crypto';

export interface StoredFileMetadata {
  /** Provider discriminator persisted in file_objects.provider. */
  provider: 'SUPABASE' | 'S3';
  bucket: string;
  objectKey: string;
}

export interface UploadResult extends StoredFileMetadata {
  sizeBytes: bigint;
  sha256: string;
}

export interface DownloadDescriptor {
  url: string;
  expiresAt: Date;
}

/**
 * Application port for binary storage. Implementations must never return
 * provider credentials and must scope every object key to the tenant/company
 * pair supplied by the caller.
 */
export abstract class StorageAdapter {
  abstract readonly provider: 'SUPABASE' | 'S3';
  abstract upload(input: { tenantId: string; companyId: string; fileName: string; contentType: string; body: Buffer }): Promise<UploadResult>;
  abstract createDownloadUrl(stored: StoredFileMetadata, input: { fileName: string; contentType: string; ttlSeconds: number }): Promise<DownloadDescriptor>;
  abstract deleteObject(stored: StoredFileMetadata): Promise<void>;

  /** Deterministic, unguessable object key bound to the owning scope. */
  protected buildObjectKey(tenantId: string, companyId: string, fileName: string) {
    const safeName = (fileName.split('/').pop() ?? 'file').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'file';
    return `tenants/${tenantId}/companies/${companyId}/${randomUUID()}/${safeName}`;
  }
}

export function extensionOf(fileName: string) {
  const match = /\.([A-Za-z0-9]{1,10})$/.exec(fileName);
  return match ? match[1].toLowerCase() : '';
}

const ALLOWED_CONTENT_TYPES = new Map<string, string>([
  ['pdf', 'application/pdf'],
  ['png', 'image/png'],
  ['jpg', 'image/jpeg'],
  ['jpeg', 'image/jpeg'],
  ['webp', 'image/webp'],
  ['gif', 'image/gif'],
  ['txt', 'text/plain'],
  ['rtf', 'application/rtf'],
  ['doc', 'application/msword'],
  ['docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['xls', 'application/vnd.ms-excel'],
  ['xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['csv', 'text/csv'],
]);

/** Content type is derived from the extension whitelist, never trusted from the client alone. */
export function allowedContentType(fileName: string): string | null {
  return ALLOWED_CONTENT_TYPES.get(extensionOf(fileName)) ?? null;
}
