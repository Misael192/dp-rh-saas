import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { AuthUser } from '../auth/auth.types';
import type { CreateEmployeeInput, EmployeeQuery, UpdateEmployeeInput } from './employee.schemas';
import { DuplicateEmployeeRegistrationError, EmployeeRecord, EmployeesRepository } from './domain/employees.repository';

/** Public representation omits tenant/user security identifiers. */
export function employeeView(employee: EmployeeRecord) {
  return {
    id: employee.id, registration: employee.registration, fullName: employee.fullName, email: employee.email,
    jobTitle: employee.jobTitle, departmentName: employee.departmentName, hiredAt: employee.hiredAt.toISOString().slice(0, 10),
    status: employee.status, createdAt: employee.createdAt.toISOString(), updatedAt: employee.updatedAt.toISOString(),
  };
}

@Injectable()
export class EmployeesService {
  constructor(@Inject(EmployeesRepository) private readonly employees: EmployeesRepository) {}

  private requireStaff(user: AuthUser) {
    if (user.role !== 'ADMIN' && user.role !== 'HR') throw new ForbiddenException('Acesso restrito à administração e ao RH.');
  }

  private ownUserId(user: AuthUser): string | undefined {
    if (user.role === 'EMPLOYEE') return user.id;
    this.requireStaff(user);
    return undefined;
  }

  async companies(user: AuthUser) {
    const company = await this.employees.company({ tenantId: user.tenantId, companyId: user.companyId });
    if (!company) throw new NotFoundException('Empresa não encontrada.');
    return { items: [company] };
  }

  async list(user: AuthUser, query: EmployeeQuery) {
    const ownUserId = this.ownUserId(user);
    const page = await this.employees.list({ tenantId: user.tenantId, companyId: user.companyId }, query, ownUserId);
    return { items: page.items.map(employeeView), total: page.total, page: query.page, pageSize: query.pageSize };
  }

  async get(user: AuthUser, id: string) {
    const ownUserId = this.ownUserId(user);
    const employee = await this.employees.get({ tenantId: user.tenantId, companyId: user.companyId }, id, ownUserId);
    if (!employee) throw new NotFoundException('Colaborador não encontrado.');
    return employeeView(employee);
  }

  async create(user: AuthUser, input: CreateEmployeeInput) {
    this.requireStaff(user);
    try { return employeeView(await this.employees.create(user, input)); }
    catch (error) { return this.rethrowWriteError(error); }
  }

  async update(user: AuthUser, id: string, input: UpdateEmployeeInput) {
    this.requireStaff(user);
    try {
      const employee = await this.employees.update(user, id, input);
      if (!employee) throw new NotFoundException('Colaborador não encontrado.');
      return employeeView(employee);
    } catch (error) { return this.rethrowWriteError(error); }
  }

  async dashboard(user: AuthUser) {
    this.requireStaff(user);
    const dashboard = await this.employees.dashboard({ tenantId: user.tenantId, companyId: user.companyId });
    return { ...dashboard, recentAdmissions: dashboard.recentAdmissions.map(employeeView) };
  }

  private rethrowWriteError(error: unknown): never {
    if (error instanceof DuplicateEmployeeRegistrationError) throw new ConflictException('Esta matrícula já existe nesta empresa.');
    throw error;
  }
}
