import { BadRequestException, Body, type CallHandler, Controller, Get, HttpCode, Injectable, Inject, type NestInterceptor, ExecutionContext, Param, Patch, PayloadTooLargeException, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Observable } from 'rxjs';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, Public } from '../auth/decorators';
import { AppConfig } from '../common/config';
import {
  addVersionSchema, createDocumentSchema, createSignatureSchema, createTemplateSchema,
  documentIdSchema, documentQuerySchema, downloadTokenSchema, rejectSignatureSchema, signDocumentSchema,
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

/** Absolute transport ceiling for multer (decorators are evaluated before DI).
 * The authoritative per-deployment limit is DOCUMENT_MAX_UPLOAD_BYTES, enforced
 * post-parse by MulterLimitsGuard and re-checked inside DocumentsService.validateUpload. */
const DOCUMENT_MULTER_HARD_CAP = 50 * 1024 * 1024;

@Injectable()
export class MulterLimitsGuard implements NestInterceptor {
  constructor(@Inject(AppConfig) private readonly config: AppConfig) {}
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ file?: { size?: number }; files?: Array<{ size?: number }> }>();
    const max = this.config.values.DOCUMENT_MAX_UPLOAD_BYTES;
    const uploaded = [request.file, ...(request.files ?? [])].filter(Boolean) as Array<{ size: number }>;
    if (uploaded.some((file) => file.size > max)) throw new PayloadTooLargeException('Arquivo maior que o limite de upload.');
    return next.handle();
  }
}

@Controller('documents')
export class DocumentsController {
  /** Resolved once at module wiring (same lazy pattern as the StorageModule factory) so the
   * multer transport limit and the service-side validation share DOCUMENT_MAX_UPLOAD_BYTES. */
  private readonly uploadLimits: { fileSize: number; files: 1 };
  constructor(
    @Inject(DocumentsService) private readonly documents: DocumentsService,
    @Inject(AppConfig) config: AppConfig,
  ) {
    this.uploadLimits = { fileSize: config.values.DOCUMENT_MAX_UPLOAD_BYTES, files: 1 };
  }

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
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DOCUMENT_MULTER_HARD_CAP, files: 1 } }), MulterLimitsGuard)
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

  /** Token-only public capability route (no session). The HMAC payload binds
   * the file to its company scope and uploader; tampered payloads are rejected. */
  @Public() @HttpCode(200) @Get(':id/download')
  download(@Param('id') id: string, @Query() query: unknown) {
    const parsed = validated(downloadTokenSchema, query);
    return this.documents.downloadUrlForToken(parsed.token, validated(documentIdSchema, id));
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
