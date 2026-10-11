import { z } from 'zod';

export const passwordSchema = z.string().min(12).max(128);
const codeSchema = z.string().regex(/^(?:\d{6}|(?:[a-fA-F0-9]{4}-){7}[a-fA-F0-9]{4})$/);
export const loginSchema = z.object({
  tenantSlug: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  companySlug: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  email: z.string().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(1).max(128),
  mfaCode: codeSchema.optional(),
}).strict();
export const changePasswordSchema = z.object({ currentPassword: z.string().min(1).max(128), newPassword: passwordSchema }).strict();
export const mfaSetupSchema = z.object({ currentPassword: z.string().min(1).max(128) }).strict();
export const mfaEnableSchema = z.object({ code: z.string().regex(/^\d{6}$/) }).strict();
export const mfaDisableSchema = z.object({ currentPassword: z.string().min(1).max(128), code: codeSchema }).strict();
export type LoginInput = z.infer<typeof loginSchema>;
