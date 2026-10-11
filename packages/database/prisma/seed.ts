import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma, Role, EmployeeStatus } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { argon2id, hash } from 'argon2';

type DemoCompany = {
  slug: string;
  name: string;
  employees: Array<{
    registration: string;
    fullName: string;
    jobTitle: string;
    departmentName: string;
    hiredAt: Date;
    status: EmployeeStatus;
  }>;
};

const demoCompanies: DemoCompany[] = [
  {
    slug: 'aurora',
    name: 'Aurora Pessoas — demonstração',
    employees: [
      { registration: 'DEMO-001', fullName: 'Marina Exemplo', jobTitle: 'Analista de Pessoas', departmentName: 'Pessoas', hiredAt: new Date('2024-02-05T00:00:00.000Z'), status: EmployeeStatus.ACTIVE },
      { registration: 'DEMO-002', fullName: 'Rafael Exemplo', jobTitle: 'Analista de Operações', departmentName: 'Operações', hiredAt: new Date('2025-04-14T00:00:00.000Z'), status: EmployeeStatus.ACTIVE },
      { registration: 'DEMO-003', fullName: 'Camila Exemplo', jobTitle: 'Assistente Administrativo', departmentName: 'Administrativo', hiredAt: new Date('2023-09-11T00:00:00.000Z'), status: EmployeeStatus.ON_LEAVE },
    ],
  },
  {
    slug: 'horizonte',
    name: 'Horizonte Pessoas — demonstração',
    employees: [
      { registration: 'DEMO-001', fullName: 'João Exemplo', jobTitle: 'Analista Financeiro', departmentName: 'Financeiro', hiredAt: new Date('2024-07-01T00:00:00.000Z'), status: EmployeeStatus.ACTIVE },
      { registration: 'DEMO-002', fullName: 'Beatriz Exemplo', jobTitle: 'Analista de Operações', departmentName: 'Operações', hiredAt: new Date('2025-01-13T00:00:00.000Z'), status: EmployeeStatus.ACTIVE },
      { registration: 'DEMO-003', fullName: 'Lucas Exemplo', jobTitle: 'Assistente Comercial', departmentName: 'Comercial', hiredAt: new Date('2023-03-06T00:00:00.000Z'), status: EmployeeStatus.TERMINATED },
    ],
  },
];

async function setScope(tx: Prisma.TransactionClient, tenantId: string, companyId = '') {
  await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.company_id', ${companyId}, true)`;
}

async function main() {
  if (process.env.SEED_DEMO !== 'true') {
    console.info('Seed demonstrativo não executado: habilite SEED_DEMO=true somente em desenvolvimento.');
    return;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Seed demonstrativo é proibido em produção.');
  }
  const databaseAdminUrl = process.env.DATABASE_ADMIN_URL;
  if (!databaseAdminUrl) throw new Error('DATABASE_ADMIN_URL é obrigatório para provisionar os dados demonstrativos.');
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 12) throw new Error('SEED_PASSWORD deve conter pelo menos 12 caracteres.');

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseAdminUrl }) });
  try {
    const passwordHash = await hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
    for (const demo of demoCompanies) {
      await prisma.$transaction(async (tx) => {
        // Tenant has public routing metadata only. All private writes below have
        // transaction-local scope, including when the admin is subject to FORCE RLS.
        const existingTenant = await tx.tenant.findUnique({ where: { slug: demo.slug } });
        const tenantId = existingTenant?.id ?? randomUUID();
        await setScope(tx, tenantId);
        const tenant = await tx.tenant.upsert({
          where: { slug: demo.slug },
          create: { id: tenantId, slug: demo.slug, name: demo.name },
          update: {},
        });
        const company = await tx.company.upsert({
          where: { tenantId_slug: { tenantId: tenant.id, slug: 'matriz' } },
          create: { tenantId: tenant.id, slug: 'matriz', name: `${demo.name} — Matriz` },
          update: {},
        });
        await setScope(tx, tenant.id, company.id);
        const adminEmail = `admin@${demo.slug}.example.invalid`;
        const employeeEmail = `colaborador@${demo.slug}.example.invalid`;
        const admin = await tx.user.upsert({
          where: { tenantId_companyId_email: { tenantId: tenant.id, companyId: company.id, email: adminEmail } },
          create: { tenantId: tenant.id, companyId: company.id, email: adminEmail, name: 'Administrador de demonstração', passwordHash, role: Role.ADMIN },
          update: {},
        });
        const employeeUser = await tx.user.upsert({
          where: { tenantId_companyId_email: { tenantId: tenant.id, companyId: company.id, email: employeeEmail } },
          create: { tenantId: tenant.id, companyId: company.id, email: employeeEmail, name: demo.employees[0].fullName, passwordHash, role: Role.EMPLOYEE },
          update: {},
        });
        for (const [index, employee] of demo.employees.entries()) {
          await tx.employee.upsert({
            where: { tenantId_companyId_registration: { tenantId: tenant.id, companyId: company.id, registration: employee.registration } },
            create: { ...employee, tenantId: tenant.id, companyId: company.id, userId: index === 0 ? employeeUser.id : null, email: index === 0 ? employeeEmail : null },
            update: {},
          });
        }
        const audit = await tx.auditLog.findFirst({ where: { tenantId: tenant.id, companyId: company.id, action: 'DEMO_SEED_CREATED' }, select: { id: true } });
        if (!audit) {
          await tx.auditLog.create({ data: { tenantId: tenant.id, companyId: company.id, userId: admin.id, action: 'DEMO_SEED_CREATED', entityId: company.id, metadata: { synthetic: true, source: 'stage-1-demo-seed' } } });
        }
      }, { timeout: 15000 });
      console.info(`Dados sintéticos preparados: cliente=${demo.slug}; empresa=matriz; admin=admin@${demo.slug}.example.invalid; colaborador=colaborador@${demo.slug}.example.invalid.`);
    }
    console.info('Seed concluído. Registros existentes e senhas foram preservados.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  // Prisma errors may contain query parameters. Do not print the error object,
  // connection string, password, hashes, or environment variable values.
  const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'SETUP';
  const safeMessage = error instanceof Error && [
    'Seed demonstrativo é proibido em produção.',
    'DATABASE_ADMIN_URL é obrigatório para provisionar os dados demonstrativos.',
    'SEED_PASSWORD deve conter pelo menos 12 caracteres.',
  ].includes(error.message) ? error.message : 'Falha ao preparar o seed. Verifique migrations, permissões e conectividade do banco administrativo.';
  console.error(`${safeMessage} Código: ${code}.`);
  process.exitCode = 1;
});
