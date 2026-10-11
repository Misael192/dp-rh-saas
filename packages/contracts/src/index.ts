import { z } from 'zod';
export const roleSchema = z.enum(['ADMIN','HR','MANAGER','EMPLOYEE']);
export const employeeStatusSchema = z.enum(['ACTIVE','ON_LEAVE','TERMINATED']);
export const employeeCreateSchema = z.object({
 registration:z.string().trim().min(1).max(40),
 fullName:z.string().trim().min(2).max(160),
 email:z.string().email().max(254).nullable().optional(),
 jobTitle:z.string().trim().min(1).max(120),
 departmentName:z.string().trim().min(1).max(120),
 hiredAt:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
 status:employeeStatusSchema.default('ACTIVE')
}).strict();
export type Role = z.infer<typeof roleSchema>;
export type EmployeeStatus = z.infer<typeof employeeStatusSchema>;
export type EmployeeCreate = z.infer<typeof employeeCreateSchema>;
export interface SessionUser { id:string;name:string;email:string;role:Role;tenantId:string;companyId:string;companyName:string;tenantName:string;mfaEnabled:boolean; }
export interface Employee {id:string;registration:string;fullName:string;email:string|null;jobTitle:string;departmentName:string;hiredAt:string;status:EmployeeStatus;createdAt:string;updatedAt:string;}
export interface Page<T> {items:T[];total:number;page:number;pageSize:number;}
export interface Dashboard {totalEmployees:number;activeEmployees:number;onLeaveEmployees:number;terminatedEmployees:number;departments:number;recentAdmissions:Employee[];}

export * from "./documents";
