import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import {
  addVersionSchema, createDocumentSchema, createSignatureSchema, createTemplateSchema,
  documentIdSchema, documentQuerySchema, rejectSignatureSchema, signDocumentSchema,
  templateIdSchema, templateQuerySchema, updateDocumentSchema, updateTemplateSchema,
} from './document.schemas';
import { DocumentsService } from './documents.service';

function validated<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({ message: 'Dados inválidos.', issues: parsed.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })) });
  }
  return parsed.data;
}

@Controller('documents')
export class DocumentsController {
  constructor(@Inject(DocumentsService) private readonly documents: DocumentsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.documents.list(user, validated(documentQuerySchema, query));
  }

  @Get('templates')
  listTemplates(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    const parsed = validated(templateQuerySchema, query);
    return this.documents.listTemplates(user, parsed.kind);
  }

  @Post('templates')
  createTemplate(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.documents.createTemplate(user, validated(createTemplateSchema, body));
  }

  @Patch('templates/:id')
  updateTemplate(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.documents.updateTemplate(user, validated(templateIdSchema, id), validated(updateTemplateSchema, body));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.get(user, validated(documentIdSchema, id));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.documents.create(user, validated(createDocumentSchema, body));
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.documents.update(user, validated(documentIdSchema, id), validated(updateDocumentSchema, body));
  }

  /** multipart upload: memory storage with an explicit size cap from configuration. */
  @Post(':id/versions')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } }))
  addVersion(@CurrentUser() user: AuthUser, @Param('id') id: string, @UploadedFile() file: Express.Multer.File | undefined, @Body() body: unknown) {
    if (!file) throw new BadRequestException('Envie o arquivo no campo "file".');
    return this.documents.addVersion(
      user,
      validated(documentIdSchema, id),
      { buffer: file.buffer, originalName: file.originalname },
      validated(addVersionSchema, body ?? {}),
    );
  }

  @Get(':id/download-url')
  downloadUrl(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.downloadUrl(user, validated(documentIdSchema, id));
  }

  @Get(':id/signatures')
  listSignatures(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.documents.listSignatures(user, validated(documentIdSchema, id));
  }

  @Post(':id/signatures')
  createSignature(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.documents.createSignature(user, validated(documentIdSchema, id), validated(createSignatureSchema, body));
  }

  @Post('signatures/:signatureId/sign')
  sign(@CurrentUser() user: AuthUser, @Param('signatureId') signatureId: string, @Body() body: unknown) {
    const parsed = validated(signDocumentSchema, body ?? {});
    return this.documents.sign(user, validated(documentIdSchema, signatureId), parsed.evidence ?? {});
  }

  @Post('signatures/:signatureId/reject')
  reject(@CurrentUser() user: AuthUser, @Param('signatureId') signatureId: string, @Body() body: unknown) {
    const parsed = validated(rejectSignatureSchema, body ?? {});
    return this.documents.reject(user, validated(documentIdSchema, signatureId), parsed.reason);
  }
}
