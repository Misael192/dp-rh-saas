# Implantação da Etapa 1 · PeopleFlow

Este guia implanta a plataforma TypeScript na raiz de `dp-rh-saas`. O legado permanece em `Misael192/Misael192.github.io` para migração futura. Os artefatos foram preparados para execução Docker ou Next.js na Vercel + NestJS na Railway. Nenhuma conta de hospedagem foi configurada nem implantação em produção realizada por esta entrega. A publicação dos fontes no GitHub é registrada em [CONTINUITY.md](CONTINUITY.md); instruções aqui não equivalem a validação em produção.

## 1. Topologia e limites da etapa

```text
Navegador ─HTTPS─ Next.js /api/v1/* ─rede privada/HTTPS─ NestJS
                                                      ├─ PostgreSQL / role runtime
                                                      └─ Redis / rate limit
Job release ─ URL administrativa ─ PostgreSQL / migrations + grants
Job backup ─ PGPASSFILE privado ─ PostgreSQL → arquivos + SHA-256
```

O navegador usa a origem da web; o Route Handler Next.js encaminha a API e retorna seus cookies. Preserve `Origin` e todos os cabeçalhos `Set-Cookie` no ingresso. Não injete `DATABASE_ADMIN_URL` na API nem na web. Redis é requisito de segurança, não cache opcional: uma indisponibilidade deve falhar fechada no rate limit.

A Etapa 1 entrega autenticação, autorização, MFA e colaboradores. O dashboard se limita aos dados persistidos por esta entrega. Integrações Supabase Storage/S3, processamento de folha, financeiro, eSocial, IA e demais módulos têm contratos e implementações a concluir em etapas posteriores.

## 2. Configuração e secrets

Use `.env.example` como catálogo de nomes. No ambiente cloud atual confira apenas presença e nomes das bindings existentes antes de criar outra configuração; não imprima valores. Não use `env`, `printenv`, rastreamento `set -x` ou dumps de credenciais.

| Variável | Destino | Regra |
| --- | --- | --- |
| `DATABASE_URL` | API | PostgreSQL runtime `peopleflow_app`, banco da aplicação, TLS conforme provedor |
| `DATABASE_ADMIN_URL` | Job release/seed local | Proprietário das migrations; nunca na API HTTP |
| `REDIS_URL` | API | Redis privado autenticado; `rediss://` quando o provedor exigir TLS |
| `JWT_SECRET` | API | Aleatório, no mínimo 32 bytes; rotação revoga tokens anteriores |
| `DATA_ENCRYPTION_KEY` | API | 32 bytes codificados em base64, usados em AES-GCM para MFA |
| `WEB_ORIGIN` | API | Origem exata da web, HTTPS em produção, sem barra final |
| `API_INTERNAL_URL` | Next.js server | Origem acessível da API; sem `NEXT_PUBLIC_`, segredo não necessário |
| `API_PROXY_SECRET` | API e Next.js server | Secret aleatório compartilhado de no mínimo 32 bytes, obrigatório em produção |
| `DEPLOYMENT_ENV` | Next.js server | `development` no Docker local e `production` no ingresso HTTPS |
| `TRUSTED_PROXY_HEADER` | Next.js server | Nome de header de IP sobrescrito pelo ingresso confiável; obrigatório em produção |
| `HOST` / `PORT` | API | `0.0.0.0` e porta provida pelo host; Docker usa 4000 |
| `REDIS_PREFIX` | API | Prefixo distinto entre ambiente/app; padrão `peopleflow` |
| `TEST_DATABASE_URL` | Testes | Banco isolado com a role runtime |
| `TEST_DATABASE_ADMIN_URL` | Testes | URL administrativa apenas do banco de teste |
| `TEST_REDIS_URL` | Testes | Redis de teste/DB separado, nunca estado real de clientes |
| `SEED_DEMO` / `SEED_PASSWORD` | Seed local | Habilitação explícita e password escolhida de modo seguro |

Gere secrets usando um gerenciador de senhas ou OpenSSL e salve diretamente no gerenciador do provedor. Exemplos locais com permissões restritas, sem imprimir valores:

```bash
umask 077
openssl rand -hex 48 > /tmp/peopleflow-jwt-secret
openssl rand -base64 32 > /tmp/peopleflow-data-key
```

Importe os arquivos pelo fluxo seguro do provedor e elimine as cópias temporárias quando não forem mais necessárias. Nunca cole os valores no chat, comite `.env` ou inclua secrets em build arguments. Passwords em URLs devem ser URI encoded. No Compose local, o gerador produz passwords hexadecimais sem caracteres especiais. A chave MFA precisa ser preservada e ter backup seguro: perdê-la impede de descriptografar os segredos já cadastrados. Rotação dessa chave requer migração deliberada das credenciais, não uma troca silenciosa de variável.

## 3. Banco de dados e isolamento

O schema Prisma contém `tenants`, `companies`, `users`, `auth_sessions`, `mfa_credentials`, `mfa_recovery_codes`, `employees` e `audit_logs`, com relacionamentos compostos tenant/empresa, índices e migrations versionadas. As policies usam `FORCE ROW LEVEL SECURITY`; `companies` exige tenant e tabelas privadas exigem tenant + empresa. `tenants` contém somente metadados de roteamento público. `peopleflow_app` não deve ser dona das tabelas.

O container PostgreSQL de desenvolvimento usa `peopleflow_migration` como administrador, reservado a instalação/migração. `infra/postgres/init-runtime-role.sh` cria `peopleflow_app` com `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION` e sem `CREATE` no schema. A senha é lida por `psql \getenv` e interpolada como literal SQL, sem concatenação.

Em PostgreSQL gerenciado, peça ao administrador para provisionar essas duas identidades com as mesmas restrições. Se o provedor não permitir `CREATE ROLE`, provisione a role runtime pelo console autorizado e confirme seus atributos. Depois execute o job de release com a URL administrativa e aplique `infra/postgres/apply-runtime-grants.sql` na mesma base. Ele concede somente:

- `SELECT` em metadados de tenant/empresa;
- `SELECT`, `INSERT`, `UPDATE` em usuários, sessões, MFA e colaboradores;
- `DELETE` somente em códigos MFA, para regeneração;
- `SELECT`, `INSERT` em auditoria, sem alteração/exclusão;
- `USAGE` em `public` e nos enums `Role`/`EmployeeStatus`; IDs UUID não exigem sequences.

Não use `GRANT ALL`, `GRANT ... ON ALL TABLES`, credenciais superuser no runtime ou desative RLS para solucionar falhas. Cada próxima migration precisa rever grants explícitos. Antes de liberar tráfego, confira:

```sql
SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
FROM pg_roles WHERE rolname = 'peopleflow_app';
SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE relname IN ('companies','users','employees','auth_sessions','mfa_credentials','mfa_recovery_codes','audit_logs');
```

Execute os testes contra a role runtime. Um administrador com bypass não prova isolamento. Além das políticas, confirme recusas de leitura e escrita entre duas empresas do mesmo tenant e entre dois tenants, inclusive tentativas de atribuir colaborador a usuário de outra empresa.

### Estado específico do workspace de desenvolvimento

Na configuração anterior, o proxy bloqueava downloads oficiais de `binaries.prisma.sh`; isso está preservado no registro histórico. Na transferência para este repositório, `npm ci` normal e `prisma migrate deploy` passaram nas bases novas `dp_rh_saas_dev` e `dp_rh_saas_test`, mantendo verificação de TLS/checksum. O client oficial continua usando `engineType="client"`/PrismaPg; a configuração restrita `generate-only.config.ts` destina-se somente à geração, nunca às migrations.

As bases antigas preservadas `peopleflow_stage1` e `peopleflow_stage1_test` receberam SQL diretamente com psql, com grants e testes RLS reais. Isso não cria `_prisma_migrations`. Se retomar uma dessas bases, confira primeiro que o schema corresponde à migration e então registre a baseline com a CLI padrão. Com a URL administrativa do banco correspondente carregada no ambiente, em `packages/database`:

```bash
DATABASE_URL="${DATABASE_ADMIN_URL:?Configure a identidade administrativa do banco local conferido}" \
  ../../node_modules/.bin/prisma migrate resolve --applied 20261010000100_stage_1_foundation
```

Esse comando de baseline não foi executado nas bases antigas. Não marque como aplicada uma migration cujo SQL não tenha sido aplicado/conferido. Uma base nova segue `npm run db:migrate` normalmente; não usa baseline. Os bancos `dp_rh_saas_dev` e `dp_rh_saas_test` já são gerenciados pelo Prisma. Não rode `migrate deploy` nas duas bases antigas antes dessa reconciliação.

Resultados atuais de builds Docker e smoke de containers estão no registro de continuidade. Use os proxies e a CA confiável fornecidos pelo ambiente cloud; não replique o hostname do proxy externo para um builder onde ele não é alcançável. Os Dockerfiles aceitam o secret BuildKit opcional `proxy_ca`, montado somente durante os comandos npm, sem incluir o certificado na imagem final. Em um cloud que fornece `CODEX_PROXY_CERT`, execute na raiz:

```bash
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -f Dockerfile.api --target runtime -t peopleflow-api:local .
docker build --secret id=proxy_ca,src="$CODEX_PROXY_CERT" -f Dockerfile.web -t peopleflow-web:local .
```

Ambientes sem proxy usam o build padrão, sem esse secret. Preserve TLS e verificação de artefatos. Execute o ensaio Compose no ambiente de release antes de implantar. Builds nativos Nest/Next e E2E do Next standalone não substituem esse ensaio.

### Primeiro cliente e administrador reais

Após migrations e grants, use o comando administrativo create-only `npm run db:provision`, a partir da raiz do repositório, para criar o primeiro cliente. Ele exige `DATABASE_ADMIN_URL` de uma identidade diferente da role runtime. Defina os campos abaixo no runner seguro, sem segredos em argumentos:

- `PROVISION_TENANT_SLUG` / `PROVISION_TENANT_NAME`: identificação do cliente;
- `PROVISION_COMPANY_SLUG` / `PROVISION_COMPANY_NAME`: primeira empresa desse cliente;
- `PROVISION_ADMIN_EMAIL` / `PROVISION_ADMIN_NAME`: administrador inicial;
- `PROVISION_PASSWORD_FILE`: caminho para arquivo privado da senha, mode 0600, pertencente ao usuário do processo e sem symlink;
- `PROVISION_CONFIRM_DATABASE`: exatamente o pathname da URL administrativa, incluindo `/`, por exemplo `/peopleflow`.

Crie ou monte o arquivo de senha pelo secret manager, com acesso somente ao usuário da job. Não use argumento de CLI, variável contendo a senha, senha padrão ou valor em chat. O CLI não imprime a senha e registra auditoria sem nomes/e-mails. Ele cria tenant, empresa e usuário `ADMIN` ativo em uma transação; se o tenant já existir, a operação é recusada sem alteração. Novas empresas em clientes existentes terão um fluxo administrativo dedicado em uma etapa futura.

No target Docker `migration`, com as mesmas bindings e o arquivo montado, o comando equivalente é `npm run provision -w @peopleflow/database`. A imagem executa como `node` (UID 1000); o arquivo deve ser legível exclusivamente por esse usuário, e não como secret genérico world-readable. Execute em runner sem tráfego HTTP. Depois remova o arquivo temporário de senha pelo fluxo seguro e valide login, troca de senha e ativação 2FA com o administrador. Esse provisionamento substitui o seed fictício para clientes reais; não relaxe a proteção do seed para lançar o produto.

## 4. Docker local e servidor próprio

Pré-requisitos: Docker Engine/Compose v2, memória suficiente para o build Next.js e portas locais 3000/4000/5432/6379 livres. Execute na raiz do repositório:

```bash
node infra/scripts/init-local-env.mjs
docker compose --env-file .env -f infra/compose.yml config --quiet
docker compose --env-file .env -f infra/compose.yml up --build -d web
docker compose --env-file .env -f infra/compose.yml ps
curl --fail http://localhost:4000/api/v1/health/live
curl --fail http://localhost:4000/api/v1/health/ready
```

O Compose cria volumes separados, espera PostgreSQL/Redis e aplica migrations + grants antes da API. Para uma segunda execução, não gere outra `.env`; o gerador recusa sobrescrever. Reexecute `up` para atualizar sem eliminar volumes. Os scripts de init PostgreSQL rodam somente em volume novo: para uma instalação já existente, provisione/ajuste a role com o administrador e reaplique os grants, preservando os dados. Não use `down --volumes` como correção de setup.

Os Dockerfiles usam Node 22 Debian slim com OpenSSL para Prisma e builds em etapas. API e Next.js executam como usuário `node`. A API runtime não contém o Prisma CLI; a imagem `migration` serve como job de release e contém as ferramentas de teste. A web usa o output standalone com tracing do workspace. `.dockerignore` exclui secrets e outputs locais do contexto de build.

Para Docker em produção, configure `NODE_ENV=production`, `DEPLOYMENT_ENV=production`, `WEB_ORIGIN=https://app.seudominio` e um ingresso TLS na frente da web. Os mapeamentos padrão são exclusivos de loopback. Exponha somente a web pelo ingresso; PostgreSQL, Redis e API devem permanecer em rede privada. O tráfego externo web→API, se houver, exige HTTPS e verificação TLS preservada. Use imagens fixadas por digest na release do ambiente, varredura de vulnerabilidades, limites de recursos, alertas e secrets do orquestrador. `restart: unless-stopped` não fornece alta disponibilidade nem substitui um banco gerenciado.

O override `infra/compose.production.yml` acrescenta Nginx HTTPS. Configure `TLS_CERTIFICATE_FILE` e `TLS_PRIVATE_KEY_FILE` com caminhos absolutos para um certificado válido e sua chave protegida. O Nginx sobrescreve `x-peopleflow-ingress-ip` com `$remote_addr`; a web usa esse header e prova seu contexto à API com `API_PROXY_SECRET`. Preserve a rede privada: não permita acesso externo direto à web que evite o ingresso. Se houver um CDN antes do Nginx, configure a lista exata de proxies confiáveis antes de derivar IPs; a configuração entregue considera o Nginx como borda direta.

```bash
docker compose --env-file .env -f infra/compose.yml -f infra/compose.production.yml config --quiet
docker compose --env-file .env -f infra/compose.yml -f infra/compose.production.yml up --build -d gateway
```

O override depende de certificados/domínio configurados pelo operador; não foi ativado no ambiente local. Não use certificados não verificados ou `curl -k` para passar os checks.

O seed fictício é separado e opt-in. Defina `SEED_DEMO=true` e uma senha privada em `.env`, depois execute `docker compose --env-file .env -f infra/compose.yml --profile demo run --rm seed`. O script recusa produção. Nunca execute para preencher dados de clientes.

## 5. Railway para NestJS

1. Crie PostgreSQL e Redis privados; obtenha bindings existentes pelo fluxo seguro da Railway.
2. Selecione a raiz do repositório como contexto e `Dockerfile.api` como Dockerfile, target `runtime`.
3. Configure os secrets da API e `HOST=0.0.0.0`. Deixe a Railway definir `PORT` e configure o probe em `/api/v1/health/ready`.
4. Execute uma release job com target `migration` e somente `DATABASE_ADMIN_URL`; seu comando é `bash infra/scripts/migrate.sh`. O runtime deve ser liberado apenas após esse job concluir.
5. Caso o provedor não ofereça job com target separado, execute a imagem `migration` em runner autorizado de CI com a binding administrativa. Não instale ferramentas de migração no serviço HTTP para contornar essa separação.
6. Configure uma origem privada ou HTTPS da API e informe-a no `API_INTERNAL_URL` da web. `WEB_ORIGIN` na API deve apontar para o domínio final da web.

A role runtime deve ser provisionada antes do primeiro release. Não se presume que a conta gerenciada permite DDL de roles; valide os atributos e grants. Logs da API não devem conter tokens, bodies de login ou URLs de conexão. A API aceita o IP encaminhado somente com `API_PROXY_SECRET` válido e endereço IP parseável; headers arbitrários do cliente são ignorados. O segredo é apenas servidor→servidor e deve ficar fora de código público e logs.

## 6. Vercel para Next.js

Defina o Root Directory do projeto como `apps/web`, framework Next.js e habilite a inclusão de arquivos fora do Root Directory no build. O monorepo npm exige acesso a `packages/` e ao lockfile na raiz do workspace. Use instalação `cd ../.. && npm ci` e build `cd ../.. && npm run build -w @peopleflow/contracts && npm run build -w @peopleflow/web`; mantenha o output padrão `.next` da aplicação. Não copie manifests nem gere um segundo lockfile.

Defina `API_INTERNAL_URL` somente como variável de servidor, apontando para a API da Railway via HTTPS. Configure `DEPLOYMENT_ENV=production`, `TRUSTED_PROXY_HEADER=x-vercel-forwarded-for` e `API_PROXY_SECRET` na web; o mesmo secret vai na API. Use esse header somente atrás do ingresso Vercel que o sobrescreve com um IP autoritativo e valide o comportamento com a documentação e o tráfego do ambiente real. Um header enviado arbitrariamente pelo navegador não deve controlar quotas. A web de produção falha fechada se o ingresso esperado não estiver configurado. Nunca crie `NEXT_PUBLIC_DATABASE_URL`, `NEXT_PUBLIC_JWT_SECRET` ou equivalente. Na API, configure `WEB_ORIGIN=https://dominio-final` e `NODE_ENV=production`. Use o domínio estável em testes; origens de preview não devem ser autorizadas automaticamente. Para previews, configure uma API e banco separados e uma origem explícita correspondente.

O proxy Next.js opera em runtime Node.js, preserva `Origin`, cookies HttpOnly e `x-csrf-token`, não armazena respostas privadas em cache e impõe timeout/body limit. Os cookies retornados permanecem na origem da web. Verifique o fluxo completo login→MFA→colaboradores→refresh→logout após definir o domínio; um `GET /login` bem-sucedido sozinho não valida autenticação.

## 7. Backup automático e restauração

O Compose fornece um perfil opcional `backup` com agendamento a cada 24 horas e retenção local de 14 dias. `backup.sh` cria `pg_dump` custom sem owner/ACL, valida o catálogo com `pg_restore --list` e gera/verifica SHA-256. O script falha se o dump/verificação falhar e o processo de backup é reiniciado pelo Compose. Retenção afeta somente arquivos `peopleflow_*.dump` e seus checksums. Defina alerta para falhas: restart por si só não notifica ninguém.

Para ativar localmente, o gerador cria `.secrets/backup.pgpass` com mode 0600. No servidor, monte um `PGPASSFILE` protegido pelo secret manager; a identidade precisa conseguir ler integralmente os dados e executar o dump com RLS. Essa credencial é privilegiada e pertence somente ao job de backup, nunca à API.

```bash
docker compose --env-file .env -f infra/compose.yml --profile backup up -d backup
docker compose --env-file .env -f infra/compose.yml logs --tail 20 backup
```

Backups contêm dados pessoais e hashes de autenticação. O volume local não protege contra perda do host: configure cópia para destino externo criptografado, permissões restritas e política de retenção documentada. Criptografia de disco/volume deve ser habilitada no provedor; envio S3/Supabase e criptografia de arquivo não foram implementados nesta etapa. Produção exige essa configuração operacional antes de receber dados reais, além de backup da chave MFA separado e seguro. A aplicação não interpreta checksum como prova de recuperação completa.

Ensaie a recuperação em uma base descartável. Descubra somente o nome do archive no log, sem exibir secrets. Substitua o nome abaixo por um arquivo existente:

```bash
docker compose --env-file .env -f infra/compose.yml --profile backup run --rm \
  -e RESTORE_DATABASE=peopleflow_restore_rehearsal \
  -e RESTORE_CONFIRM=disposable \
  --entrypoint bash backup /scripts/restore-check.sh \
  /backups/peopleflow_AAAAMMDDTHHMMSSZ_PID.dump
```

`restore-check.sh` verifica SHA-256, rejeita nomes sem o prefixo `peopleflow_restore_`, recusa banco existente e restaura com `--exit-on-error`. Exibe apenas contagens de tenant/empresa/colaboradores e mantém a base para revisão. Não exclui nem sobrescreve bancos. Revise constraints/RLS e execute testes funcionais na base restaurada; depois descarte a base pelo fluxo administrativo autorizado. Documente data, duração, resultado e responsável pelo ensaio; estabeleça RPO/RTO antes do lançamento.

## 8. Gate de release

Na raiz do repositório, execute geração Prisma, typecheck, build, testes unitários e a suíte de integração com PostgreSQL e Redis reais. Em Docker:

```bash
docker compose --env-file .env -f infra/compose.yml --profile test run --rm api-tests
```

O perfil exige explicitamente `postgres-test/peopleflow_test`, sem volume compartilhado com a aplicação. Não mude as URLs para produção. Testes diretos no host usam as URLs de teste locais definidas em `.env`, sempre para uma base isolada.

Antes de aceitar tráfego real, registre evidências de readiness, login/2FA, refresh/revogação, RBAC, CSRF e isolamento entre empresas, além de ensaio de backup/restore, HTTPS, políticas LGPD, retenção e alertas. `health/live` confirma processo; `health/ready` confirma os serviços requeridos. Logs de aplicação não substituem trilha de auditoria e nenhuma configuração isoladamente certifica conformidade legal. Pendências precisam permanecer explícitas no registro de continuidade. Aguarde aprovação do usuário antes de iniciar a Etapa 2.
