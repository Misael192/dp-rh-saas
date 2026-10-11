import type { CreateEmployeeInput, EmployeeQuery, UpdateEmployeeInput } from '../employee.schemas';

export type EmployeeStatus = 'ACTIVE' | 'ON_LEAVE' | 'TERMINATED';
export interface CompanyScope { tenantId: string; companyId: string; }
export interface EmployeeActor extends CompanyScope { id: string; }
export interface EmployeeRecord {
  id: string; registration: string; fullName: string; email: string | null; jobTitle: string; departmentName: string;
  hiredAt: Date; status: EmployeeStatus; createdAt: Date; updatedAt: Date;
}
export interface EmployeePage { items: EmployeeRecord[]; total: number; }
export interface EmployeeDashboard {
  totalEmployees: number; activeEmployees: number; onLeaveEmployees: number; terminatedEmployees: number;
  departments: number; recentAdmissions: EmployeeRecord[];
}
export interface CompanyRecord { id: string; name: string; slug: string; }

/** Application port: every operation requires explicit tenant AND company context. */
export abstract class EmployeesRepository {
  abstract company(scope: CompanyScope): Promise<CompanyRecord | null>;
  abstract list(scope: CompanyScope, query: EmployeeQuery, ownUserId?: string): Promise<EmployeePage>;
  abstract get(scope: CompanyScope, id: string, ownUserId?: string): Promise<EmployeeRecord | null>;
  abstract create(actor: EmployeeActor, input: CreateEmployeeInput): Promise<EmployeeRecord>;
  abstract update(actor: EmployeeActor, id: string, input: UpdateEmployeeInput): Promise<EmployeeRecord | null>;
  abstract dashboard(scope: CompanyScope): Promise<EmployeeDashboard>;
}

export class DuplicateEmployeeRegistrationError extends Error {}
