# Etapa 2 — Registro de 11/10/2026

## Estado

A implementação de documentos e storage está mergeada na `main` em `2ce60b420b6f1ed727df8292aaa66145f87af02e` (PR #1). Não houve implantação em produção. O PR #2, `hotfix/stage2-typecheck-and-docs`, permanece aberto e não deve ser mergeado sem aprovação explícita.

## Cronologia verificada

| Commit | Decisão/evidência |
| --- | --- |
| `05874738e19e4e0a08209f7e7777ebf960991a6d` | Implementação Stage 2; commit intermediário incluiu acidentalmente dependências/artefatos gerados (`node_modules`, 4.633 arquivos). |
| `d78dfb7466084d06ad7b2af5c2432c799daa8aa4` | Interrompeu o rastreamento de `node_modules` e artefatos de build; não reescrever o histórico publicado. |
| `ff67e244c0166f8ec50ed7a61d2430cee02914e4` | Commit de documentação/configuração Stage 2 no branch da implementação. |
| `f99d6ce8198223d8b59558f7e7777ebf960991a6d` | Commit de implementação de documentos Stage 2 no branch da implementação. |
| `2ce60b420b6f1ed727df8292aaa66145f87af02e` | Merge do PR #1 na `main`; CI encontrou `TS2339` pela ausência de `signerUserId` no contrato `SignatureView`. |
| `a2fe61f5278a298e5ecc531564046e42f877cf47` | Commit do PR #2: adicionou `signerUserId` nullable ao contrato/serialização e documentação faltante. Typecheck local e build local passaram. CI passou pelo typecheck, mas falhou em um teste unitário por fixture com tenant/empresa diferentes. |
| `5728ceaa693ec62a66f6a305ad07b2c47f0220cc` | CI run `38115604182`: typecheck e unit tests passaram; integração PostgreSQL/Redis falhou. Corrigidos no checkout colisões de PK por `actor.id` copiado para registros Prisma, ordem de teardown da FK `currentVersionId` e `.setQuery()` não suportado pelo Supertest. |
| `2999848a6b8524d380ef353d62f6c1a893a43ba6` | CI run `38116220981`: typecheck/unit tests passaram; cinco cenários de integração falharam e 20 testes Stage 1 ficaram skipped. O log apontou projeção aninhada Prisma sem `select` e ausência de configuração sintética de storage na suíte Stage 1; ambos corrigidos no checkout. |
| `60d3822e2165b14db3fda0202ef108e2fe08e7a2` | CI run `38116831216`: os 20 testes Stage 1 passaram; 26/29 testes totais passaram. O teste de detalhe esperava versões crescentes, mas o endpoint retorna decrescente. A expectativa foi corrigida localmente; auditoria e assinatura falharam em cascata porque a primeira asserção interrompeu a criação da assinatura. |

## Decisões e desvios

- Não executar `reset --hard`, rebase destrutivo ou force-push; preservar o histórico e corrigir no branch aberto.
- A rota entregue é `apps/web/src/app/(workspace)/documentos/page.tsx` (`/documentos`). Os testes têm nomes `documents.test.ts` e `documents.integration.test.ts`.
- `infra/scripts/check-test-database.mjs` restringe os testes Compose a `postgres-test/peopleflow_test` e role runtime `peopleflow_app`. Eventual contorno fora do Compose é somente local; não é prova de RLS nem deve enfraquecer a CI.
- A alteração unitária do hotfix alinha os usuários no mesmo tenant/empresa e mantém IDs distintos, para que a expectativa de visibilidade por usuário seja válida.
- O `.vscode/` não rastreado encontrado no checkout foi preservado e não incluído no hotfix.

## Evidências e pendências

- `npm test`: 23/23 passou localmente depois de corrigir o fixture.
- `npm run typecheck`: PASS em API, web, contracts e database após o ajuste do fixture/documentação.
- `npm run build`: PASS; Prisma Client, contracts, API e Next.js; rota `/documentos` incluída.
- CI do PR #2 no SHA `a2fe61f`: 22 testes passaram, um falhou (`EMPLOYEE only sees own documents via listVisibleToUser`, `expected [] to deeply equal [Array(1)]`). Novo run após o ajuste do fixture ainda pendente.
- `npm test`: 23/23 PASS após as correções do fixture e do adapter.
- `npm run typecheck` e `npm run build`: PASS após as correções de código em 2026-10-11.
- Após corrigir a projeção aninhada e configurar storage sintético para Stage 1, `npm test` passou 23/23, `npm run typecheck` passou e `npm run build` passou novamente.
- Após alinhar a expectativa à ordem descendente de versões, `npm run typecheck`, `npm test` (23/23) e `npm run build` passaram novamente.
- Integração PostgreSQL/RLS: nove cenários existem. Não foi executada localmente por ausência de `.env` e banco de teste local; o último run remoto falhou e precisa ser repetido após push.
- Aguardar CI remota verde após o novo push, review e autorização explícita antes do merge. Não iniciar a Etapa 3 nem implantar em produção.