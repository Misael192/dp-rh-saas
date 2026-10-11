import { Module } from '@nestjs/common';
import { CompaniesController, DashboardController, EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { EmployeesRepository } from './domain/employees.repository';
import { PrismaEmployeesRepository } from './infrastructure/prisma-employees.repository';

@Module({
  controllers: [EmployeesController, CompaniesController, DashboardController],
  providers: [EmployeesService, { provide: EmployeesRepository, useClass: PrismaEmployeesRepository }],
})
export class EmployeesModule {}
