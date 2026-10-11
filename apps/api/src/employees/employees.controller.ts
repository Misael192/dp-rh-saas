import { BadRequestException, Body, Controller, Get, Inject, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser } from '../auth/decorators';
import { createEmployeeSchema, employeeIdSchema, employeeQuerySchema, updateEmployeeSchema } from './employee.schemas';
import { EmployeesService } from './employees.service';

function validated<T extends z.ZodTypeAny>(schema: T, value: unknown): z.output<T> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({ message: 'Dados inválidos.', issues: parsed.error.issues.map(({ path, message }) => ({ path: path.join('.'), message })) });
  }
  return parsed.data;
}

@Controller('employees')
export class EmployeesController {
  constructor(@Inject(EmployeesService) private readonly employees: EmployeesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() query: unknown) {
    return this.employees.list(user, validated(employeeQuerySchema, query));
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.employees.get(user, validated(employeeIdSchema, id));
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    return this.employees.create(user, validated(createEmployeeSchema, body));
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body() body: unknown) {
    return this.employees.update(user, validated(employeeIdSchema, id), validated(updateEmployeeSchema, body));
  }
}

@Controller('companies')
export class CompaniesController {
  constructor(@Inject(EmployeesService) private readonly employees: EmployeesService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.employees.companies(user);
  }
}

@Controller('dashboard')
export class DashboardController {
  constructor(@Inject(EmployeesService) private readonly employees: EmployeesService) {}

  @Get()
  get(@CurrentUser() user: AuthUser) {
    return this.employees.dashboard(user);
  }
}
