import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AppConfig } from '../common/config';
import { DownloadDescriptor, StorageAdapter, StoredFileMetadata, UploadResult } from './storage.adapter';

/**
 * AWS S3 adapter (also works with any S3-compatible endpoint such as Supabase
 * Storage's S3 API or MinIO). Credentials stay server-side; downloads use
 * short-lived presigned GET URLs so the bucket never becomes public.
 */
@Injectable()
export class S3StorageAdapter extends StorageAdapter {
  readonly provider = 'S3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: AppConfig) {
    super();
    const values = config.values;
    if (!values.STORAGE_BUCKET || !values.AWS_ACCESS_KEY_ID || !values.AWS_SECRET_ACCESS_KEY || !values.AWS_REGION) {
      throw new Error('S3 storage requires STORAGE_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY and AWS_REGION');
    }
    this.bucket = values.STORAGE_BUCKET;
    this.client = new S3Client({
      region: values.AWS_REGION,
      ...(values.S3_ENDPOINT_URL ? { endpoint: values.S3_ENDPOINT_URL, forcePathStyle: true } : {}),
      credentials: { accessKeyId: values.AWS_ACCESS_KEY_ID, secretAccessKey: values.AWS_SECRET_ACCESS_KEY },
    });
  }

  async upload(input: { tenantId: string; companyId: string; fileName: string; contentType: string; body: Buffer }): Promise<UploadResult> {
    const objectKey = this.buildObjectKey(input.tenantId, input.companyId, input.fileName);
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket, Key: objectKey, Body: input.body, ContentType: input.contentType,
      // Server-side encryption for personal data at rest; metadata keeps the
      // original name without trusting the client-supplied filename later.
      ServerSideEncryption: 'AES256',
      Metadata: { 'original-name': encodeURIComponent(input.fileName.split('/').pop() ?? 'file') },
    }));
    return {
      provider: this.provider, bucket: this.bucket, objectKey,
      sizeBytes: BigInt(input.body.byteLength), sha256: createHash('sha256').update(input.body).digest('hex'),
    };
  }

  async createDownloadUrl(stored: StoredFileMetadata, input: { fileName: string; contentType: string; ttlSeconds: number }): Promise<DownloadDescriptor> {
    const command = new GetObjectCommand({
      Bucket: stored.bucket, Key: stored.objectKey, ResponseContentType: input.contentType,
      ResponseContentDisposition: `attachment; filename="${encodeURIComponent(input.fileName.split('/').pop() ?? 'file')}"`,
    });
    const url = await getSignedUrl(this.client, command, { expiresIn: Math.max(1, Math.min(input.ttlSeconds, 7 * 24 * 3600)) });
    return { url, expiresAt: new Date(Date.now() + input.ttlSeconds * 1000) };
  }

  async deleteObject(stored: StoredFileMetadata): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: stored.bucket, Key: stored.objectKey }));
  }
}
