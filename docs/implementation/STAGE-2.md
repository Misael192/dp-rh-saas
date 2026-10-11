# Etapa 2 — Documentos e armazenamento

**Status:** funcionalidade mergeada na `main` pelo PR #1 (`2ce60b420b6f1ed727df8292aaa66145f87af02e`). O hotfix que corrige o contrato `SignatureView` e completa esta documentação está no branch `hotfix/stage2-typecheck-and-docs`; aguardar revisão e aprovação explícita antes do merge. Não houve implantação em produção.

## Entregáveis e evidências

| # | Entregável | Evidência no repositório |
| --- | --- | --- |
| 1 | Schema Prisma com cinco enums e cinco modelos novos, escopados por tenant/empresa e ligados por FKs compostas. | `packages/database/prisma/schema.prisma` — `StorageProvider`, `DocumentKind`, `DocumentStatus`, `SignatureRole`, `SignatureStatus`; `FileObject`, `DocumentTemplate`, `Document`, `DocumentVersion`, `DocumentSignature`. |
| 2 | Migration versionada para os objetos de banco da Etapa 2. | `packages/database/prisma/migrations/20261011000200_add_stage2_documents/migration.sql`. |
| 3 | RLS habilitada e forçada para as tabelas privadas da Etapa 2, com políticas por contexto da empresa. | `infra/postgres/rls-stage2.sql`; grants complementares em `infra/postgres/apply-runtime-grants.sql`. |
| 4 | Porta de storage e adapters para Supabase e S3, incluindo upload, remoção e URL assinada. | `apps/api/src/storage/storage.adapter.ts`, `supabase-storage.adapter.ts`, `s3-storage.adapter.ts` e `storage.module.ts`. |
| 5 | Proteções de arquivos: allowlist de tipos/extensões, chave aleatória com escopo, hash SHA-256 e capability de download assinada por HMAC. | `apps/api/src/documents/documents.service.ts`, `apps/api/src/storage/download-token.ts` e `apps/api/src/storage/storage.adapter.ts`. |
| 6 | API de documentos e modelos, CRUD, versões, uploads, downloads e registro manual de assinaturas, com autorização e auditoria. | `apps/api/src/documents/` — controller, service, schemas, porta e repositório Prisma. |
| 7 | Contratos compartilhados para documentos, versões e assinaturas; o hotfix acrescenta `signerUserId: string | null` ao retorno de assinatura. | `packages/contracts/src/documents.ts` e exportação em `packages/contracts/src/index.ts`; serialização em `apps/api/src/documents/documents.service.ts`. |
| 8 | Interface de documentos com navegação e gates de acesso no workspace. | Rota real: `apps/web/src/app/(workspace)/documentos/page.tsx`; view em `apps/web/src/components/documents-view.tsx`. |
| 9 | Testes unitários e de integração específicos para storage/documentos, incluindo isolamento RLS. | `apps/api/test/unit/documents.test.ts` (15 casos) e `apps/api/test/integration/documents.integration.test.ts` (8 casos); a suíte unitária total contém 23 casos com os testes de segurança existentes. |
| 10 | Configuração e documentação operacional da etapa, sem credenciais reais. | Variáveis comentadas em `.env.example`; este registro e `docs/implementation/CONTINUITY.md`. |

## Validação

O workflow do commit de merge `2ce60b4` falhou em `npm run typecheck` com `TS2339` porque `signerUserId` era usado pela view web, mas não estava no tipo `SignatureView`. A suíte não prosseguiu além desse erro; portanto, esse workflow não comprova build nem testes para o estado final do merge.

No hotfix local, em 2026-10-11:

| Comando | Resultado |
| --- | --- |
| `npm ci` | PASS; 448 pacotes instalados. O npm reportou 10 vulnerabilidades na árvore instalada; nenhuma foi corrigida por este hotfix. |
| `npm run db:generate` | PASS; Prisma Client 6.19.3 gerado do schema da Etapa 2. |
| `npm run build -w @peopleflow/contracts` | PASS; necessário antes do typecheck em checkout limpo porque o workspace web consome os tipos compilados de `dist`. |
| `npm run typecheck` | PASS em API, web, contracts e database, depois da geração do client e do build de contracts. |
| `npm run build` | PASS; geração Prisma, contracts, API e Next.js. A rota `/documentos` foi incluída no build. |
| Testes de integração/RLS | Os oito cenários estão presentes, mas não foram executados novamente neste hotfix. O workflow do merge falhou antes dessa etapa. |

`npm ci` e a geração do Prisma Client foram necessários porque o `node_modules` local não correspondia ao lockfile/schema depois do pull. Em instalação limpa, gere também `packages/contracts/dist` antes de executar `npm run typecheck`; `npm run build` da raiz compila os workspaces na ordem necessária.

## Desvios e decisões

- **Rota:** a implementação mergeada usa `(workspace)/documentos`, não o caminho intermediário `(app)/documents` descrito em notas do trabalho. A tabela acima registra a rota real.
- **Nomes dos testes:** os arquivos finais usam `documents.test.ts` e `documents.integration.test.ts`, não o sufixo `.spec.ts` citado em uma nota intermediária. Os arquivos contêm 15 casos unitários de documentos e oito casos de integração; com os oito unitários de segurança, são 23 casos unitários no total.
- **Incidente `node_modules`:** o commit intermediário `0587473` adicionou acidentalmente `node_modules` (4.633 arquivos, mais de 1,3 milhão de linhas). A árvore do commit mergeado não contém esse diretório; dependências devem ser restauradas com `npm ci`, nunca versionadas.
- **Checker do banco de teste:** `infra/scripts/check-test-database.mjs` é deliberadamente específico do Compose e exige host `postgres-test`, banco `peopleflow_test` e role runtime `peopleflow_app`. O contorno usado no ambiente local para esse checker foi local, não está versionado e não substitui os checks do Compose/CI com banco isolado e role sem privilégios.
- **Typecheck do merge:** CI detectou a ausência de `signerUserId` no contrato. O hotfix acrescenta o campo nullable e o serializa como `signature.signerUserId ?? null`; o typecheck local e o build passam. A correção só estará na `main` depois de aprovada e mergeada.
- **Credenciais de storage:** `.env.example` contém somente exemplos comentados. Chaves Supabase/AWS e segredo HMAC devem ser fornecidos por configuração privada/secret manager; não registrar valores reais em documentação ou logs.

## Próximo passo

Aguardar review e autorização explícita do usuário para mergear o PR do hotfix. Não fazer merge, não implantar em produção e não iniciar a Etapa 3 sem essa autorização.