import { Module } from '@nestjs/common';
import { AppConfig } from '../common/config';
import { S3StorageAdapter } from './s3-storage.adapter';
import { StorageAdapter } from './storage.adapter';
import { SupabaseStorageAdapter } from './supabase-storage.adapter';

/**
 * Storage foundation: the application depends only on the StorageAdapter port.
 * The concrete provider is selected once, at bootstrap, through
 * STORAGE_PROVIDER (SUPABASE | S3). Adapters validate their own credentials in
 * the constructor so a misconfigured deployment fails fast at startup.
 */
@Module({
  providers: [
    {
      provide: StorageAdapter,
      inject: [AppConfig],
      useFactory: (config: AppConfig) =>
        config.values.STORAGE_PROVIDER === 'S3'
          ? new S3StorageAdapter(config)
          : new SupabaseStorageAdapter(config),
    },
  ],
  exports: [StorageAdapter],
})
export class StorageModule {}
