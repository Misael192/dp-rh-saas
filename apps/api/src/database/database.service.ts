import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { z } from 'zod';

const scopeSchema = z.object({ tenantId: z.string().uuid(), companyId: z.string().uuid().optional() });
export interface DatabaseScope { tenantId: string; companyId?: string; }

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() { super({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) }); }
  async onModuleInit() {
    await this.$connect();
    const [role] = await this.$queryRaw<Array<{ rolsuper: boolean; rolbypassrls: boolean }>>`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    if (!role || role.rolsuper || role.rolbypassrls) throw new Error('Runtime PostgreSQL role must not be superuser or BYPASSRLS');
    const tables = await this.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relnamespace = current_schema()::regnamespace AND relname IN ('tenants','companies','users','auth_sessions','mfa_credentials','mfa_recovery_codes','employees','audit_logs')`;
    if (tables.length !== 8 || tables.some(table => !table.relrowsecurity || !table.relforcerowsecurity)) throw new Error('Required PostgreSQL tables must enable and force RLS');
  }
  async onModuleDestroy() { await this.$disconnect(); }
  async withScope<T>(scope: DatabaseScope, callback: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const parsed = scopeSchema.parse(scope);
    return this.$transaction(async tx => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${parsed.tenantId}, true), set_config('app.company_id', ${parsed.companyId ?? ''}, true)`;
      return callback(tx);
    }, { timeout: 10000, maxWait: 5000 });
  }
}
