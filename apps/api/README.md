# API PeopleFlow — Etapa 1

NestJS modular; controladores fazem validação HTTP, serviços executam regras de autenticação e os repositórios Prisma operam em transações com escopo. O módulo de colaboradores usa o mesmo contexto autenticado. Apenas esta fundação está implementada; módulos posteriores continuam no roteiro geral.

## Executar

Na raiz do repositório, siga `.env.example` e o guia de implantação. Node 22–24, PostgreSQL com migration aplicada e Redis são obrigatórios. Execute `npm ci`, `npm run db:generate`, `npm run build -w @peopleflow/api`, `npm run dev:api`. O servidor procura `.env` da plataforma sem imprimir seus valores. `ENV_FILE` permite indicar outro arquivo local. `HOST` padrão `127.0.0.1`, `PORT` padrão `4000`; Docker usa `HOST=0.0.0.0`.

Use `DATABASE_URL` com role runtime sem superuser, BYPASSRLS ou DDL. Startup verifica ENABLE/FORCE RLS nas oito tabelas desta etapa. Use credencial administrativa separada somente para migrations/provisionamento.

## Contratos de autenticação

Todas as rotas têm prefixo `/api/v1`. Sucesso de login/refresh retorna `{ user }`, sem tokens no JSON. Usuário público: `id`, `name`, `email`, `role`, `tenantId`, `companyId`, `companyName`, `tenantName`, `mfaEnabled`.

| Método/rota | Corpo | Resposta |
|---|---|---|
| GET `/auth/csrf` | — | `{csrfToken}` e cookie HttpOnly `csrf_token` |
| POST `/auth/login` | `tenantSlug, companySlug, email, password, mfaCode?` | 200 `{user}` e cookies de sessão |
| POST `/auth/refresh` | `{}` | 200 `{user}` e cookies rotacionados |
| GET `/auth/me` | — | 200 `{user}` |
| POST `/auth/logout` | `{}` | 204; revoga somente a sessão autenticada |
| POST `/auth/change-password` | `currentPassword, newPassword` | 204; revoga todas as sessões |
| POST `/auth/mfa/setup` | `currentPassword` | 200 `{otpauthUri}`; configuração pendente por 10 minutos |
| POST `/auth/mfa/enable` | `code` TOTP com seis dígitos | 200 `{recoveryCodes}` uma vez; revoga todas as sessões |
| POST `/auth/mfa/disable` | `currentPassword, code` | 204; exige TOTP/código de recuperação e revoga todas as sessões |
| GET `/health/live` | — | 200 `{status:'ok'}` |
| GET `/health/ready` | — | 200 `{status:'ready'}` com PostgreSQL e Redis disponíveis; 503 caso contrário |

Todo POST/PATCH exige `Origin` exatamente igual a `WEB_ORIGIN`, cookie `csrf_token` e header `x-csrf-token` correspondente. Isso inclui login e refresh. Campos desconhecidos são rejeitados. O GET CSRF reutiliza um cookie válido para preservar outras abas. O frontend usa um proxy de mesma origem; não há CORS amplo nem bearer alternativo nesta etapa.

Cookies de acesso: HttpOnly, SameSite Strict, path `/api/v1`, 15 minutos. Refresh: HttpOnly, SameSite Strict, path `/api/v1/auth`, expiração absoluta de sete dias. Em produção todos são Secure e `WEB_ORIGIN` deve usar HTTPS. Refresh não estende a expiração absoluta.

## Garantias e limites

- JWT HS256 verifica issuer `peopleflow`, audience `peopleflow-web`, algoritmo e expiração. O guard também consulta sessão, usuário ativo, versão de token e empresa/tenant ativos em cada requisição privada.
- Refresh contém UUIDs de tenant/empresa/sessão e segredo aleatório de 256 bits. Só hashes SHA-256 são persistidos. Rotação usa `SELECT ... FOR UPDATE`; reuso conhecido revoga a família, representada pela sessão. Um segredo inventado não revoga a sessão de terceiros. Histórico máximo de 2048 rotações, seguido de login obrigatório. Logout confirma segredo e proprietário.
- Senhas: Argon2id (64 MiB, três passagens), mínimo de 12 caracteres nas novas senhas. Login usa hash fictício para não pular o custo de verificação quando a conta não existe. Mudança de senha revalida a senha atual e invalida todas as sessões.
- MFA: TOTP de 30 segundos, tolerância de um intervalo, contador monotônico contra replay. Segredo AES-256-GCM com AAD vinculada ao usuário/tenant/empresa. Dez códigos de recuperação aleatórios de 128 bits; somente hashes, consumo único transacional. O código usado para ativar MFA não pode ser usado imediatamente no login; aguarde o próximo intervalo ou use um código de recuperação.
- Limites Redis são atômicos por script Lua. Indisponibilidade do Redis bloqueia as operações protegidas. `RATE_LIMIT_MAX` controla escritas de autenticação por IP/minuto (30 por padrão); `RATE_LIMIT_LOGIN_MAX` controla tentativas por identidade/5 minutos (10). API geral: 300 requisições/IP/minuto. Namespaces usam `REDIS_PREFIX`; testes não precisam apagar o Redis inteiro.
- A API ignora headers de IP enviados por clientes diretos. O BFF pode informar `x-peopleflow-client-ip` apenas com `x-peopleflow-proxy-key` correto (`API_PROXY_SECRET`, obrigatório em produção, mínimo 32 bytes). A origem do IP no BFF deve ser um header sanitizado por um ingress confiável; consulte a implantação. Nunca exponha esse segredo ao navegador.
- Contexto PostgreSQL é `SET LOCAL` via `set_config` dentro da transação. Ausência de empresa permite apenas o lookup de empresa no login, e as tabelas privadas continuam inacessíveis. FKs compostas impedem relações entre escopos.
- Auditoria de autenticação e alterações é transacional. Logs HTTP incluem request ID gerado pelo servidor, template de rota, status e duração; nunca cookies, bodies, queries, emails, stack ou parâmetros Prisma. Erros 500 retornam mensagem genérica. Helmet e limite de body de 64 KiB são globais.

Esta etapa não implementa recuperação por e-mail, administração completa de usuários/empresas, SSO, análise de risco por dispositivo ou rotação automatizada de chaves. Não apresentar esses itens como entregues.

## Validação

`npm run test -w @peopleflow/api` executa testes unitários de criptografia, CSRF, validação estrita, proxy e JWT. `npm run test:integration -w @peopleflow/api` usa PostgreSQL/Redis reais e banco de testes dedicado, incluindo isolamento RLS, permissões, revogação, MFA e replay. Nunca use uma base de produção no teste de integração. `npm run typecheck -w @peopleflow/api` e `npm run build -w @peopleflow/api` verificam a compilação.
