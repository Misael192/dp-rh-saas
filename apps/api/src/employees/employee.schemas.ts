import { z } from 'zod';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a data no formato AAAA-MM-DD.').refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Data inválida.');

export const employeeStatusSchema = z.enum(['ACTIVE', 'ON_LEAVE', 'TERMINATED']);

const employeeFields = {
  registration: z.string().trim().min(1).max(40),
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).nullable().optional(),
  jobTitle: z.string().trim().min(1).max(120),
  departmentName: z.string().trim().min(1).max(120),
  hiredAt: dateOnly,
  status: employeeStatusSchema,
};

export const createEmployeeSchema = z.object({
  ...employeeFields,
  status: employeeStatusSchema.default('ACTIVE'),
}).strict();

export const updateEmployeeSchema = z.object(employeeFields).partial().strict()
  .refine((value) => Object.keys(value).length > 0, 'Informe pelo menos um campo.');

export const employeeQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: employeeStatusSchema.optional(),
}).strict();

export const employeeIdSchema = z.string().uuid();

export type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;
export type EmployeeQuery = z.infer<typeof employeeQuerySchema>;
