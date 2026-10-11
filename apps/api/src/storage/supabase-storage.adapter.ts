import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { AppConfig } from '../common/config';
import { DownloadDescriptor, StorageAdapter, StoredFileMetadata, UploadResult } from './storage.adapter';

interface SupabaseResponse {
  error?: { message?: string };
  path?: string;
}

/**
 * Supabase Storage adapter (S3-compatible bucket accessed through the Storage
 * REST API). Uses only the service role key held by the server; the key never
 * leaves this process and download URLs are signed by Supabase itself.
 */
@Injectable()
export class SupabaseStorageAdapter extends StorageAdapter {
  readonly provider = 'SUPABASE' as const;
  private readonly baseUrl: string;
  private readonly serviceRoleKey: string;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    super();
    const values = config.values;
    if (!values.SUPABASE_URL || !values.SUPABASE_SERVICE_ROLE_KEY || !values.STORAGE_BUCKET) {
      throw new Error('Supabase storage requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and STORAGE_BUCKET');
    }
    this.baseUrl = new URL(values.SUPABASE_URL).origin;
    this.serviceRoleKey = values.SUPABASE_SERVICE_ROLE_KEY;
    this.bucket = values.STORAGE_BUCKET;
  }

  private headers() {
    return { authorization: `Bearer ${this.serviceRoleKey}`, apikey: this.serviceRoleKey };
  }

  async upload(input: { tenantId: string; companyId: string; fileName: string; contentType: string; body: Buffer }): Promise<UploadResult> {
    const objectKey = this.buildObjectKey(input.tenantId, input.companyId, input.fileName);
    const response = await fetch(`${this.baseUrl}/storage/v1/object/${encodeURIComponent(this.bucket)}/${objectKey}`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': input.contentType, 'x-upsert': 'false' },
      body: input.body,
      signal: AbortSignal.timeout(60_000),
    });
    const payload = (await response.json().catch(() => ({}))) as SupabaseResponse;
    if (!response.ok || payload.error) throw new Error(`Supabase upload failed (${response.status})`);
    return {
      provider: this.provider, bucket: this.bucket, objectKey,
      sizeBytes: BigInt(input.body.byteLength), sha256: createHash('sha256').update(input.body).digest('hex'),
    };
  }

  async createDownloadUrl(stored: StoredFileMetadata, input: { fileName: string; contentType: string; ttlSeconds: number }): Promise<DownloadDescriptor> {
    const response = await fetch(`${this.baseUrl}/storage/v1/object/sign/${encodeURIComponent(stored.bucket)}/${stored.objectKey}`, {
      method: 'POST',
      headers: { ...this.headers(), 'content-type': 'application/json' },
      body: JSON.stringify({ expiresIn: input.ttlSeconds }),
      signal: AbortSignal.timeout(15_000),
    });
    const payload = (await response.json().catch(() => ({}))) as { signedURL?: string; error?: { message?: string } };
    if (!response.ok || !payload.signedURL || payload.error) throw new Error(`Supabase sign failed (${response.status})`);
    const url = new URL(payload.signedURL, this.baseUrl);
    // Preserve the original download name without exposing the service key.
    url.searchParams.set('download', input.fileName.split('/').pop() ?? 'file');
    return { url: url.toString(), expiresAt: new Date(Date.now() + input.ttlSeconds * 1000) };
  }

  async deleteObject(stored: StoredFileMetadata): Promise<void> {
    const response = await fetch(`${this.baseUrl}/storage/v1/object/${encodeURIComponent(stored.bucket)}/${stored.objectKey}`, {
      method: 'DELETE', headers: this.headers(), signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok && response.status !== 404) throw new Error(`Supabase delete failed (${response.status})`);
  }
}
