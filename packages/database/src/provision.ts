import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PrismaClient, Prisma, Role } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { argon2id, hash } from 'argon2';
import { z } from 'zod';

const slug = z.string().trim().toLowerCase().min(1).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
const displayName = z.string().trim().min(2).max(160).refine((value) => !/[\x00-\x1f\x7f]/.test(value));
const configSchema = z.object({
  DATABASE_ADMIN_URL: z.string().url().refine((value) => ['postgres:', 'postgresql:'].includes(new URL(value).protocol)),
  DATABASE_URL: z.string().url().optional(),
  PROVISION_CONFIRM_DATABASE: z.string().min(2),
  PROVISION_TENANT_SLUG: slug,
  PROVISION_TENANT_NAME: displayName,
  PROVISION_COMPANY_SLUG: slug,
  PROVISION_COMPANY_NAME: displayName,
  PROVISION_ADMIN_EMAIL: z.string().trim().toLowerCase().email().max(254),
  PROVISION_ADMIN_NAME: displayName,
  PROVISION_PASSWORD_FILE: z.string().min(1),
});
const passwordSchema = z.string().min(12).max(128).regex(/^[^\r\n\x00]+$/);

class ProvisioningError extends Error {}

async function readPasswordFile(path: string): Promise<string> {
  let file;
  try {
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await file.stat();
    if (!info.isFile() || (info.mode & 0o777) !== 0o600 || info.uid !== process.getuid?.() || info.nlink !== 1 || info.size > 512) {
      throw new ProvisioningError('O arquivo de senha deve ser regular, sem links, com modo 0600 e pertencer ao operador.');
    }
    // Permit a single newline written by a secret-file tool. Do not trim spaces
    // or normalize the password; those characters are part of the credential.
    const content = (await file.readFile('utf8')).replace(/\r?\n$/, '');
    const parsed = passwordSchema.safeParse(content);
    if (!parsed.success) throw new ProvisioningError('A senha deve ter de 12 a 128 caracteres, sem quebras de linha ou NUL.');
    return parsed.data;
  } catch (error) {
    if (error instanceof ProvisioningError) throw error;
    throw new ProvisioningError('Não foi possível ler o arquivo de senha com segurança.');
  } finally {
    await file?.close();
  }
}

export async function provision(environment: NodeJS.ProcessEnv): Promise<void> {
  const result = configSchema.safeParse(environment);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))];
    throw new ProvisioningError(`Variáveis de configuração ausentes ou inválidas: ${fields.join(', ')}.`);
  }
  const config = result.data;
  const adminUrl = new URL(config.DATABASE_ADMIN_URL);
  if (adminUrl.pathname === '/' || config.PROVISION_CONFIRM_DATABASE !== adminUrl.pathname) {
    throw new ProvisioningError('PROVISION_CONFIRM_DATABASE deve corresponder exatamente ao pathname do banco administrativo.');
  }
  const adminRole = decodeURIComponent(adminUrl.username);
  if (!adminRole || adminRole === 'peopleflow_app' || (config.DATABASE_URL && decodeURIComponent(new URL(config.DATABASE_URL).username) === adminRole)) {
    throw new ProvisioningError('Use uma conexão administrativa distinta da role runtime da aplicação.');
  }
  const password = await readPasswordFile(config.PROVISION_PASSWORD_FILE);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: config.DATABASE_ADMIN_URL }) });
  try {
    // Verify the actual database role, not only the user written in the URL. This
    // catches a connection proxy assigning a runtime role to an admin URL.
    const [permissions] = await prisma.$queryRaw<Array<{
      role_name: string;
      can_insert_tenants: boolean;
      can_insert_companies: boolean;
      can_insert_users: boolean;
      can_insert_audit: boolean;
    }>>`SELECT current_user::text AS role_name,
      has_table_privilege(current_user, 'public.tenants', 'INSERT') AS can_insert_tenants,
      has_table_privilege(current_user, 'public.companies', 'INSERT') AS can_insert_companies,
      has_table_privilege(current_user, 'public.users', 'INSERT') AS can_insert_users,
      has_table_privilege(current_user, 'public.audit_logs', 'INSERT') AS can_insert_audit`;
    if (!permissions || permissions.role_name === 'peopleflow_app' || !permissions.can_insert_tenants || !permissions.can_insert_companies || !permissions.can_insert_users || !permissions.can_insert_audit) {
      throw new ProvisioningError('A conexão administrativa não tem permissões de provisionamento.');
    }
    const passwordHash = await hash(password, { type: argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1 });
    const tenantId = randomUUID();
    const companyId = randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('app.tenant_id', ${tenantId}, true), set_config('app.company_id', ${companyId}, true)`;
      const existing = await tx.tenant.findUnique({ where: { slug: config.PROVISION_TENANT_SLUG }, select: { id: true } });
      if (existing) throw new ProvisioningError('O cliente já existe. Nenhum cadastro ou credencial foi alterado.');
      await tx.tenant.create({ data: { id: tenantId, slug: config.PROVISION_TENANT_SLUG, name: config.PROVISION_TENANT_NAME } });
      await tx.company.create({ data: { id: companyId, tenantId, slug: config.PROVISION_COMPANY_SLUG, name: config.PROVISION_COMPANY_NAME } });
      await tx.user.create({ data: { tenantId, companyId, email: config.PROVISION_ADMIN_EMAIL, name: config.PROVISION_ADMIN_NAME, passwordHash, role: Role.ADMIN, isActive: true } });
      await tx.auditLog.create({ data: { tenantId, companyId, action: 'COMPANY_PROVISIONED', entityId: companyId, metadata: { source: 'operator-cli', version: 1 } } });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    console.info('Cliente, empresa e administrador criados. Auditoria registrada.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  provision(process.env).catch((error: unknown) => {
    // Prisma error bodies contain query parameters, so never print them. The
    // operator receives only controlled messages or a diagnostic code.
    if (error instanceof ProvisioningError) console.error(error.message);
    else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') console.error('O cadastro já existe. A transação foi revertida sem alterar credenciais.');
    else {
      const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : 'PROVISION';
      console.error(`Falha no provisionamento. Verifique migrations, permissões e conectividade. Código: ${code}.`);
    }
    process.exitCode = 1;
  });
}
