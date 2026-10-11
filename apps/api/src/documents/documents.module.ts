import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { DocumentsController, MulterLimitsGuard } from './documents.controller';
import { DocumentsService } from './documents.service';
import { DocumentsRepository } from './domain/documents.repository';
import { PrismaDocumentsRepository } from './infrastructure/prisma-documents.repository';

@Module({
  imports: [StorageModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, MulterLimitsGuard, { provide: DocumentsRepository, useClass: PrismaDocumentsRepository }],
})
export class DocumentsModule {}
