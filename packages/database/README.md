# Banco de dados — Etapa 1

Prisma 6.19.3 com PostgreSQL 16+, UUID, timestamps com fuso e relacionamentos compostos. Este schema entrega somente identidade, empresas, colaboradores, sessões, MFA e auditoria. Os demais módulos do roadmap ainda não estão implementados.

## Estrutura

```text
packages/database/
├── prisma/
│   ├── schema.prisma
│   ├── generate-only.config.ts
│   ├── seed.ts
│   └── migrations/
│       ├── migration_lock.toml
│       └── 20261010000100_stage_1_foundation/migration.sql
└── src/index.ts
```

## Isolamento e integridade

- `Tenant` contém apenas metadados de roteamento público para resolver o cliente no login. Não coloque senhas, documentos ou dados privados nesse modelo.
- `Company` exige contexto do tenant. Isso permite resolver o slug da empresa antes de consultar o usuário.
- `User`, `Employee`, `AuthSession`, `MfaCredential`, `MfaRecoveryCode` e `AuditLog` exigem tenant **e** empresa. A migration ativa `ENABLE ROW LEVEL SECURITY` e `FORCE ROW LEVEL SECURITY`.
- Cada consulta privada ocorre numa transação com `set_config('app.tenant_id', ..., true)` e `set_config('app.company_id', ..., true)`. O terceiro argumento `true` limita o contexto à transação. Contexto ausente ou vazio retorna zero linhas e bloqueia inserções. Não use configuração persistente da sessão com pools de conexão.
- Chaves estrangeiras `(tenant_id, company_id, user_id)` asseguram que funcionários, sessões e credenciais pertençam ao mesmo usuário/empresa, mesmo quando um administrador do banco pode contornar RLS.
- A role da API não pode ser superuser, ter `BYPASSRLS`, ser dona das tabelas, nem possuir permissões DDL. Execute os grants de `infra/` após as migrations.
- Auditoria é append-only para a role runtime: apenas `SELECT` e `INSERT` possuem policies e grants. Superusers e administradores do banco continuam capazes de alterar dados; retenção externa e proteção operacional são responsabilidade da implantação.

RLS protege o banco contra consultas sem filtro ou contexto ausente; RBAC e regras de propriedade continuam necessários na aplicação. O processo autorizado a executar SQL pode alterar variáveis de contexto; jamais exponha SQL arbitrário pela API.

## Geração e migrations

Na raiz do repositório, instale com `npm ci` e execute `npm run db:generate`. O Prisma Client usa `engineType = "client"` com o adapter PostgreSQL oficial, disponível como recurso estável desde Prisma 6.16. A aplicação deve construir o cliente com `new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) })`.

`generate-only.config.ts` é usado exclusivamente por `generate`, `format` e `validate`; impede seu uso em migrations. Sua configuração do schema engine com adapter é experimental na versão 6.19.3 e serve somente para esses comandos sem conexão. Nenhuma migration de produção utiliza essa configuração. A geração e o runtime usam artefatos oficiais distribuídos pelo npm, com verificação de integridade normal.

Execute `prisma migrate deploy` com `DATABASE_URL` apontando temporariamente para a conexão administrativa, jamais para a role da API. A CLI padrão pode precisar de `binaries.prisma.sh` liberado na configuração de rede. Preserve verificações SHA-256 e TLS; não use `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING`.

A migration SQL contém RLS e CHECKs que não são inteiramente representados no schema Prisma. Preserve-os em futuras migrations; não substitua o fluxo por `prisma db push`. Verifique migrações futuras contra PostgreSQL real e uma role sem bypass.

## Seed local

O seed exige `SEED_DEMO=true`, `DATABASE_ADMIN_URL` e `SEED_PASSWORD` com pelo menos 12 caracteres. É proibido quando `NODE_ENV=production`. A senha deve ser injetada por configuração segura; o script imprime somente slugs e e-mails sintéticos.

Execute `npm run db:seed` depois das migrations. As duas contas de demonstração são:

| Cliente | Empresa | Administrador | Colaborador |
|---|---|---|---|
| `aurora` | `matriz` | `admin@aurora.example.invalid` | `colaborador@aurora.example.invalid` |
| `horizonte` | `matriz` | `admin@horizonte.example.invalid` | `colaborador@horizonte.example.invalid` |

Cada empresa recebe três colaboradores sintéticos. O usuário `EMPLOYEE` está vinculado ao primeiro. Upserts usam `update: {}`: nenhuma senha, permissão, cadastro ou status existente é redefinido. O seed não apaga dados. A auditoria de criação é inserida uma vez por empresa.

## Validação

```sh
cd packages/database
npx prisma format --config prisma/generate-only.config.ts
npx prisma validate --config prisma/generate-only.config.ts
npx prisma generate --config prisma/generate-only.config.ts
npm run typecheck
```

Esses comandos verificam o schema e os tipos, mas não comprovam isolamento. A suíte de integração da API precisa executar leitura/escrita e relacionamentos cruzados contra PostgreSQL real com a role runtime, além de testar contexto ausente, tenant errado, empresa errada e retorno do contexto após commit/rollback.
