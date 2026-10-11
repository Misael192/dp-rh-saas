import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DatabaseService } from '../../database/database.service';
import type { CreateEmployeeInput, EmployeeQuery, UpdateEmployeeInput } from '../employee.schemas';
import { CompanyScope, DuplicateEmployeeRegistrationError, EmployeeActor, EmployeesRepository } from '../domain/employees.repository';

@Injectable()
export class PrismaEmployeesRepository extends EmployeesRepository {
  constructor(@Inject(DatabaseService) private readonly database: DatabaseService) { super(); }

  company(scope: CompanyScope) {
    return this.database.withScope(scope, (tx) => tx.company.findFirst({
      where: { id: scope.companyId, tenantId: scope.tenantId, isActive: true }, select: { id: true, name: true, slug: true },
    }));
  }

  list(scope: CompanyScope, query: EmployeeQuery, ownUserId?: string) {
    const where: Prisma.EmployeeWhereInput = {
      ...scope, ...(ownUserId ? { userId: ownUserId } : {}), ...(query.status ? { status: query.status } : {}),
      ...(query.q ? { OR: [
        { fullName: { contains: query.q, mode: 'insensitive' as const } },
        { registration: { contains: query.q, mode: 'insensitive' as const } },
        { departmentName: { contains: query.q, mode: 'insensitive' as const } },
        { jobTitle: { contains: query.q, mode: 'insensitive' as const } },
      ] } : {}),
    };
    return this.database.withScope(scope, async (tx) => {
      const [items, total] = await Promise.all([
        tx.employee.findMany({ where, orderBy: [{ fullName: 'asc' }, { id: 'asc' }], skip: (query.page - 1) * query.pageSize, take: query.pageSize }),
        tx.employee.count({ where }),
      ]);
      return { items, total };
    });
  }

  get(scope: CompanyScope, id: string, ownUserId?: string) {
    return this.database.withScope(scope, (tx) => tx.employee.findFirst({ where: { ...scope, id, ...(ownUserId ? { userId: ownUserId } : {}) } }));
  }

  async create(actor: EmployeeActor, input: CreateEmployeeInput) {
    try {
      return await this.database.withScope(actor, async (tx) => {
        const employee = await tx.employee.create({ data: {
          ...input, tenantId: actor.tenantId, companyId: actor.companyId, email: input.email ?? null,
          hiredAt: new Date(`${input.hiredAt}T00:00:00.000Z`),
        } });
        await this.audit(tx, actor, 'employee.created', employee.id);
        return employee;
      });
    } catch (error) { return this.rethrowWriteError(error); }
  }

  async update(actor: EmployeeActor, id: string, input: UpdateEmployeeInput) {
    try {
      return await this.database.withScope(actor, async (tx) => {
        const where = { id, tenantId: actor.tenantId, companyId: actor.companyId };
        if (!await tx.employee.findFirst({ where, select: { id: true } })) return null;
        const employee = await tx.employee.update({
          where: { tenantId_companyId_id: where },
          data: { ...input, ...(input.hiredAt ? { hiredAt: new Date(`${input.hiredAt}T00:00:00.000Z`) } : {}) },
        });
        await this.audit(tx, actor, 'employee.updated', employee.id);
        return employee;
      });
    } catch (error) { return this.rethrowWriteError(error); }
  }

  dashboard(scope: CompanyScope) {
    return this.database.withScope(scope, async (tx) => {
      const [statuses, departments, recentAdmissions] = await Promise.all([
        tx.employee.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
        tx.employee.groupBy({ by: ['departmentName'], where: scope }),
        tx.employee.findMany({ where: scope, orderBy: [{ hiredAt: 'desc' }, { id: 'asc' }], take: 5 }),
      ]);
      const count = (status: string) => statuses.find((entry) => entry.status === status)?._count._all ?? 0;
      return {
        totalEmployees: statuses.reduce((total, entry) => total + entry._count._all, 0),
        activeEmployees: count('ACTIVE'), onLeaveEmployees: count('ON_LEAVE'), terminatedEmployees: count('TERMINATED'),
        departments: departments.length, recentAdmissions,
      };
    });
  }

  private async audit(tx: Prisma.TransactionClient, actor: EmployeeActor, action: string, entityId: string) {
    await tx.auditLog.create({ data: { tenantId: actor.tenantId, companyId: actor.companyId, userId: actor.id, action, entityId, metadata: {} } });
  }

  private rethrowWriteError(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new DuplicateEmployeeRegistrationError();
    throw error;
  }
}
