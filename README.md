# dp-rh-saas · PeopleFlow

Etapa 1 do SaaS de DP/RH, com identidade PeopleFlow. Este repositório concentra a plataforma Next.js/NestJS, anteriormente desenvolvida em `platform/` de [Misael192.github.io](https://github.com/Misael192/Misael192.github.io). O legado PHP/Laravel permanece no repositório anterior. Esta entrega contém a fundação de autenticação, contexto multiempresa, RBAC, 2FA e colaboradores; recrutamento, férias, folha, IA, faturamento e armazenamento de documentos serão implementados nas próximas etapas aprovadas.

Leia primeiro [`AGENTS.md`](AGENTS.md), o [registro de continuidade](docs/implementation/CONTINUITY.md), a [entrega da etapa](docs/implementation/STAGE-1.md) e o [guia de implantação](docs/implementation/DEPLOYMENT.md). O registro permite que outra pessoa ou IA retome do ponto exato, com pendências e evidências. Use o checkout existente; cada tarefa cloud já é isolada, portanto não crie um Git worktree sem pedido explícito.

## Organização

```text
dp-rh-saas/
├── apps/
│   ├── api/src/           # NestJS: HTTP, auth, autorização, colaboradores
│   └── web/src/           # Next.js 15: UI, formulários e proxy same-origin
├── packages/
│   ├── contracts/         # Contratos e validação compartilhados
│   └── database/prisma/   # Schema, migrations e seed explícito
├── infra/
│   ├── compose.yml        # PostgreSQL, Redis, API, web e jobs opcionais
│   ├── postgres/          # Role runtime e grants mínimos
│   └── scripts/           # Migração, demo, testes e backup/restauração
├── Dockerfile.api         # API não privilegiada + target de migration
├── Dockerfile.web         # Next.js standalone
└── .env.example           # Nomes de configuração; sem segredos
```

## Desenvolvimento no ambiente cloud

Node.js 22–24, npm, PostgreSQL 17 e Redis 7 são necessários. `package-lock.json` fixa as dependências; use `npm ci`. Execute os comandos na raiz deste repositório:

Neste workspace, os bancos novos `dp_rh_saas_dev` e `dp_rh_saas_test` foram criados para esta plataforma e receberam a migration pela CLI oficial do Prisma. As bases anteriores `peopleflow_stage1` e `peopleflow_stage1_test`, preservadas no histórico, receberam SQL com psql e continuam exigindo revisão/baseline antes de usar migrations Prisma. As instruções abaixo destinam-se a uma base nova ou já gerenciada normalmente pelo Prisma; nunca faça reset de um banco existente para configurar o projeto.

```bash
npm ci
npm run db:generate
npm run db:migrate
node --env-file=.env infra/scripts/apply-grants.mjs
npm run build
npm run typecheck
npm test
npm run test:integration
npm run dev:api
```

Em outro terminal, use `npm run dev:web`. Os scripts do workspace carregam a configuração local de `.env`; siga os nomes em `.env.example`. API e web usam as portas 4000 e 3000. No desenvolvimento direto no host, `DATABASE_URL`, `DATABASE_ADMIN_URL` e `REDIS_URL` apontam para os serviços locais; `API_INTERNAL_URL=http://127.0.0.1:4000`. Configure `WEB_ORIGIN` exatamente para a origem usada no navegador: `http://localhost:3000` e `http://127.0.0.1:3000` são origens diferentes.

O banco runtime deve usar `peopleflow_app`, sem superuser, `BYPASSRLS` ou DDL. `DATABASE_ADMIN_URL` é usado somente nos comandos de migração/seed. Aplique os grants de `infra/postgres/apply-runtime-grants.sql` depois das migrations. Os testes de integração exigem um banco separado e devem consultar com a role runtime; um teste executado como superuser não comprova isolamento por RLS.

Os checks obrigatórios da etapa são geração Prisma, types, build, testes unitários e integração real PostgreSQL/Redis. Antes de considerar o ambiente funcional, execute uma requisição de readiness e um fluxo autenticado de colaboradores. Comandos listados aqui são instruções reproduzíveis; os resultados efetivamente obtidos nesta sessão ficam no registro de continuidade.

## Execução local com Docker

Docker Engine e Compose v2 permitem subir os serviços sem instalar PostgreSQL no host. O gerador abaixo cria segredos aleatórios apenas para desenvolvimento, em arquivos privados, e preserva configurações existentes:

```bash
node infra/scripts/init-local-env.mjs
docker compose --env-file .env -f infra/compose.yml config --quiet
docker compose --env-file .env -f infra/compose.yml up --build -d web
docker compose --env-file .env -f infra/compose.yml ps
curl --fail http://localhost:4000/api/v1/health/ready
```

O job `migrate` aplica migrations e grants antes da API iniciar. A API recebe apenas a URL runtime; a URL administrativa não é injetada no container HTTP. A web encaminha `/api/v1/*` à API pelo servidor, preservando `Origin`, cookies HttpOnly e o cabeçalho CSRF; o navegador não precisa acessar a API diretamente.

Se `.env` já existir para desenvolvimento direto no host, preserve esse arquivo. Gere a configuração Compose em outra pasta (`node infra/scripts/init-local-env.mjs /workspace/peopleflow-compose`) e substitua `--env-file .env` pelo caminho dessa nova `.env`. O gerador também define o caminho do `PGPASSFILE` correspondente; não reutilize URLs de loopback do host dentro dos containers.

Para dados fictícios, habilite `SEED_DEMO=true` em `.env` e escolha `SEED_PASSWORD` no arquivo privado. Depois execute:

```bash
docker compose --env-file .env -f infra/compose.yml --profile demo run --rm seed
```

O seed recusa ambiente de produção. Consulte os slugs e e-mail sintéticos em `packages/database/prisma/seed.ts`. Não publique as credenciais de demonstração e nunca use o seed em bancos com dados reais.

Para cadastrar um primeiro cliente real, use `npm run db:provision` com a identidade administrativa, os dados `PROVISION_*` e uma senha fornecida em arquivo privado mode 0600, conforme o [guia de implantação](docs/implementation/DEPLOYMENT.md). O comando cria tenant, empresa e administrador de forma atômica e recusa sobrescrever um tenant existente. Provisionamento não usa o seed de demonstração.

Execute o perfil de testes isolado:

```bash
docker compose --env-file .env -f infra/compose.yml --profile test run --rm api-tests
```

Esse perfil usa `postgres-test/peopleflow_test`, em outro cluster temporário, e Redis DB 1. Os testes não recebem a URL do banco da aplicação. Não altere os valores de teste para bancos de clientes.

## Segurança e operação

A API valida os dados e a configuração, usa Argon2id, JWT, refresh rotativo, criptografia autenticada dos segredos MFA, cookies HttpOnly, CSRF, Helmet, Redis para rate limit e auditoria no banco. O contexto tenant/empresa vem da sessão autenticada e é aplicado na transação PostgreSQL; chaves estrangeiras compostas e RLS reforçam as fronteiras.

Em produção, use HTTPS, `NODE_ENV=production` na API, `DEPLOYMENT_ENV=production` na web e `WEB_ORIGIN=https://seu-dominio` sem caminho ou barra final. Segredos devem ficar no gerenciador do provedor, fora do repositório. Não registre passwords, tokens, cookies, dados de MFA ou URLs de conexão. A web usa apenas o IP no `TRUSTED_PROXY_HEADER` sobrescrito pelo ingresso autorizado e autentica esse contexto à API com `API_PROXY_SECRET` compartilhado. A API não habilita `trust proxy` e ignora headers de IP sem essa prova. No Docker local sem ingresso os limites são agregados pelo proxy. O guia inclui um ingresso Nginx HTTPS e as configurações de Vercel; verifique a origem real dos headers antes de escalar instâncias.

O perfil `backup` agenda dumps com checksum e retenção local; o [guia de implantação](docs/implementation/DEPLOYMENT.md) descreve a ativação e o ensaio de restauração. Produção também exige armazenamento de backup fora do volume primário, criptografia em repouso, monitoração e testes periódicos de recuperação. Supabase Storage/S3, eSocial, assinatura eletrônica, billing e provedores de IA são próximos incrementos, ainda não implementados.

Esta etapa não publica recursos externos nem certifica conformidade LGPD, folha/CLT ou aptidão final para produção. Ao concluir os checks e a revisão da Etapa 1, aguarde aprovação do usuário antes de desenvolver a Etapa 2.
