import { z } from 'zod';

export const documentKindSchema = z.enum(['CONTRACT', 'TERM_SHEET', 'POLICY', 'PAYSLIP', 'DECLARATION', 'OTHER']);
export const documentStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);
export const signatureRoleSchema = z.enum(['EMPLOYEE', 'EMPLOYER', 'WITNESS']);
export const signatureStatusSchema = z.enum(['PENDING', 'SIGNED', 'REJECTED']);

const uuidSchema = z.string().uuid();

export const documentQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(200).optional(),
  kind: documentKindSchema.optional(),
  status: documentStatusSchema.optional(),
  employeeId: uuidSchema.optional(),
}).strict();

export const documentIdSchema = uuidSchema;

/** A new document always starts as DRAFT and needs its first version upload. */
export const createDocumentSchema = z.object({
  title: z.string().trim().min(2).max(200),
  kind: documentKindSchema,
  employeeId: uuidSchema.nullable().optional(),
  templateId: uuidSchema.nullable().optional(),
}).strict();

export const updateDocumentSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  status: z.enum(['PUBLISHED', 'ARCHIVED']).optional(),
  employeeId: uuidSchema.nullable().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Informe pelo menos um campo.');

export const addVersionSchema = z.object({
  note: z.string().trim().max(500).optional(),
}).strict();

export const createSignatureSchema = z.object({
  role: signatureRoleSchema,
  signerName: z.string().trim().min(2).max(160).optional(),
  /** Optional link to a platform user (the manual signature is still recorded by name). */
  signerUserId: uuidSchema.optional(),
}).strict().refine(
  (value) => Boolean(value.signerName || value.signerUserId),
  { message: 'Informe signerName ou signerUserId.', path: ['signerName'] },
);

export const signDocumentSchema = z.object({
  /** Free-form evidence captured at signing time (ip/ua declarations are NOT trusted verbatim). */
  evidence: z.record(z.string().max(40)).optional(),
}).strict();

export const rejectSignatureSchema = z.object({
  reason: z.string().trim().min(3).max(500),
}).strict();

export const templateQuerySchema = z.object({
  kind: documentKindSchema.optional(),
}).strict();

export const createTemplateSchema = z.object({
  code: z.string().trim().regex(/^[A-Z0-9]+(_[A-Z0-9]+)*$/, 'Use letras/números maiúsculos separados por underscore.'),
  name: z.string().trim().min(2).max(160),
  kind: documentKindSchema,
  description: z.string().trim().max(500).nullable().optional(),
  defaultFileName: z.string().trim().min(3).max(255),
}).strict();

export const updateTemplateSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  description: z.string().trim().max(500).nullable().optional(),
  defaultFileName: z.string().trim().min(3).max(255).optional(),
  isActive: z.boolean().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, 'Informe pelo menos um campo.');

export const downloadTokenSchema = z.object({
  token: z.string().min(32).max(4096),
}).strict();

export const templateIdSchema = uuidSchema;

export type DocumentQuery = z.infer<typeof documentQuerySchema>;
export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type AddVersionInput = z.infer<typeof addVersionSchema>;
export type CreateSignatureInput = z.infer<typeof createSignatureSchema>;
export type TemplateQuery = z.infer<typeof templateQuerySchema>;
export type CreateTemplateInput = z.infer<typeof createTemplateSchema>;
export type UpdateTemplateInput = z.infer<typeof updateTemplateSchema>;
