# PeopleFlow Web — Etapa 1

Interface Next.js 15 e React 19 conectada à API NestJS. Esta entrega cobre autenticação, dashboard cadastral, colaboradores, empresa atual e segurança da conta. Os módulos futuros são identificados na navegação como próximas etapas, sem operações simuladas.

## Arquitetura e estrutura

```text
src/
  app/
    (workspace)/       # páginas autenticadas
    api/v1/[...path]/  # proxy same-origin para NestJS
    login/            # acesso ao workspace
    recuperacao/      # códigos MFA, fora do layout autenticado
  components/
    ui/               # componentes Shadcn/Radix reutilizáveis
    *-view.tsx        # módulos e estados de carregamento/erro/vazio
  lib/
    api.ts            # HTTP, CSRF, refresh e erros
    types.ts          # tipos compartilhados e apresentação
  middleware.ts       # CSP com nonce por resposta
e2e/stage1.spec.ts     # fluxos reais de navegador
```

TanStack Query gerencia dados remotos, cache e invalidação; React Hook Form e Zod validam os formulários; os contratos TypeScript vêm de `@peopleflow/contracts`. Tailwind e componentes Shadcn baseados em Radix cuidam dos controles, foco e diálogo móvel. Framer Motion respeita preferência de movimento reduzido. Fontes de sistema evitam requisições externas no build.

## API e banco

O navegador usa exclusivamente `/api/v1` no domínio da interface. O proxy lê `API_INTERNAL_URL` no servidor e encaminha cookies e Origin para a API, que autoriza cada operação. Prisma, migrations, PostgreSQL, Redis e isolamento de dados pertencem ao backend; não há banco ou dados demonstrativos no frontend.

APIs consumidas: `/auth/csrf`, `/auth/login`, `/auth/me`, `/auth/refresh`, `/auth/logout`, `/auth/change-password`, `/auth/mfa/setup`, `/auth/mfa/enable`, `/auth/mfa/disable`, `/dashboard`, `/companies`, `/employees` e `/employees/:id`.

Administrador e RH podem cadastrar/editar colaboradores. Funcionário consulta apenas o cadastro associado à própria conta. Gestor tem empresa e segurança disponíveis nesta etapa; indicadores/equipe dependem de um modelo de gestão futura. O servidor impõe essas regras independentemente da navegação. Desligamento ocorre por atualização de situação, preservando histórico; exclusão destrutiva não está disponível.

## Sessão e segurança

Tokens JWT e refresh permanecem em cookies HttpOnly; não são lidos nem gravados no armazenamento do navegador. Mutação exige CSRF e Origin. A renovação usa Web Locks para serializar abas e verifica `/auth/me` após adquirir o lock. Navegadores sem Web Locks não renovam automaticamente e exigem novo login ao expirar o acesso. Em produção, Web Locks e clipboard exigem HTTPS.

Se o guard retorna `CSRF_REJECTED`, o cliente obtém um token atual e repete a operação uma única vez. Outras respostas 403 não são repetidas. Senha e MFA revogam sessões; códigos de recuperação ficam apenas em memória até a confirmação explícita. Recarregar a página descarta os códigos, por isso há aviso antes de sair.

A CSP usa nonce por resposta, autoriza apenas scripts do Next.js e tema com nonce, bloqueia frames/objetos e permite estilos inline necessários aos componentes. O proxy limita corpos a 64 KiB durante leitura incremental. Em produção exige chave privada `API_PROXY_SECRET` e um header sobrescrito por ingress confiável, configurado por `TRUSTED_PROXY_HEADER`, para a API distinguir o IP do cliente. Nunca confie em um header enviado diretamente pelo usuário nem exponha a API privada sem necessidade.

## Execução e implantação

Instale e execute pela raiz de `dp-rh-saas`, seguindo o README principal e o guia de implantação. Não crie outro Git worktree: tarefas em nuvem já executam em ambiente isolado.

```bash
npm ci
npm run db:generate
npm run build -w @peopleflow/contracts
npm run dev:api
# Em outro terminal:
npm run dev:web
```

Para desenvolvimento, `API_INTERNAL_URL=http://127.0.0.1:4000` e `DEPLOYMENT_ENV=development`. O endereço utilizado no navegador deve corresponder exatamente ao `WEB_ORIGIN` da API.

Para produção, use `DEPLOYMENT_ENV=production`, HTTPS, `WEB_ORIGIN` correto e uma `API_PROXY_SECRET` compartilhada com a API, gerada e injetada com segurança. Na Vercel, configure `TRUSTED_PROXY_HEADER=x-vercel-forwarded-for`, sobrescrito pelo ingress da plataforma. Em Docker, o proxy reverso deve remover/sobrescrever o header configurado e ser o único caminho de acesso à aplicação. `API_INTERNAL_URL` é privada e jamais recebe prefixo `NEXT_PUBLIC_`.

O build usa `output: standalone` com raiz de tracing do workspace. Container deve copiar `.next/standalone` e `apps/web/.next/static` e executar `node apps/web/server.js`. A leitura de headers para nonce torna as páginas dinâmicas; não use export estático/GitHub Pages para esta aplicação.

## Validação

```bash
npm run typecheck -w @peopleflow/web
npm run build -w @peopleflow/web
# Suite de navegador pelo comando/configuração Playwright do workspace.
```

Execute `npm run test:e2e` na raiz do repositório após build. A configuração Playwright cria fixtures exclusivas automaticamente usando `TEST_DATABASE_URL`, `TEST_DATABASE_ADMIN_URL` e `TEST_REDIS_URL`; disponibiliza internamente `E2E_TENANT_SLUG`, `E2E_COMPANY_SLUG`, `E2E_EMAIL`, `E2E_PASSWORD` e a conta MFA. Não é necessário cadastrar ou informar credenciais manualmente. A suíte cobre acesso sem sessão, login, cadastro/edição, persistência, filtro/paginação do servidor, logout, móvel/tema, renovação em abas, expiração CSRF, CSP/limite de corpo e códigos MFA. O relatório final do workspace registra quais verificações foram executadas; a presença dos testes não significa que passaram.
