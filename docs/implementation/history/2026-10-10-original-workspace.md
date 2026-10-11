# PeopleFlow — registro de continuidade

## Objetivo e autorização
O usuário pediu desenvolvimento incremental na stack Next.js 15/React/TypeScript/Tailwind/Shadcn + NestJS/Prisma/PostgreSQL/Redis, com autenticação JWT/refresh/RBAC/2FA, isolamento total entre empresas e log para retomada por outra IA.

Esta sessão inicia a Etapa 1 após o diagnóstico. Não avançar para a Etapa 2 sem aprovação explícita do usuário. Não afirmar que todos os módulos ou a implantação de produção estão prontos.

## Estado inicial
- Checkout GitHub: Misael192/Misael192.github.io, HEAD 8de21c6.
- Legado em PHP/Laravel e MVP em mvp/. Mantê-los preservados durante a migração.
- Diagnóstico anterior em /workspace/reports/peopleflow-avaliacao.md (artefato local; síntese será persistida em docs).
- Etapa 1 em desenvolvimento em platform/: monorepo isolado dentro do mesmo checkout, sem worktree.

## Escopo da Etapa 1
Banco com constraints e RLS, autenticação e revogação, 2FA, permissões, API/UX reais para colaboradores, dashboard limitado aos dados entregues, testes PostgreSQL/Redis, documentação de implantação e registro final de evidências.

## Retomada
1. Ler este registro, AGENTS.md, docs/implementation/STAGE-1.md e platform/README.md quando existirem.
2. Conferir git status e preservar alterações locais.
3. Usar Node 22–24 e npm ci em platform/. Seguir .env.example sem copiar valores secretos para logs.
4. Consultar checklist e última execução abaixo. Executar testes necessários após mudanças.
5. Atualizar este arquivo a cada marco; registrar comandos, resultados, pendências e próximo passo exato.

## Marcos
- Início: criado monorepo platform/ e este registro.
- Banco, API auth/colaboradores e frontend implementados; 8 testes unitários e 20 integrações reais PostgreSQL/Redis passaram. API build/typecheck e frontend build/typecheck passaram antes dos últimos ajustes QA; validação final em andamento.
- Backup custom PG17 + checksum/restauração em banco novo sintético passaram; tentativa repetir restauração no mesmo destino recusada.
- Novo anexo do usuário revisado sem executar: ver CLAUDE-COMMAND-REVIEW.md. Script escreve scaffold em /home/claude/peopleflow, inexistente aqui; main/FETCH_HEAD permanecem 8de21c6 após fetch. Solicitação assíncrona por branch/commit do Claude pendente; continuar Etapa 1 sem misturar contratos incompatíveis.
- Próximo passo em andamento: Playwright Chromium com fixtures exclusivas TEST DB; auditoria dependências, provisionamento operacional e CI.
- Limitação da rede: binaries.prisma.sh bloqueado pelo proxy; configuração de allowlist salva como rascunho. Client oficial engineType=client+PrismaPg gerado sem desligar TLS/checksum. Migration SQL aplicada e validada diretamente com psql nos bancos locais novos, NÃO via prisma migrate deploy. _prisma_migrations ainda não registrada: ao liberar rede, revisar baseline e usar migrate resolve --applied somente nos bancos locais já criados; banco novo usa deploy normal.

## Checklist atual
- [x] Schema/migrations SQL e role runtime PostgreSQL (CLI migrate ainda pendente de rede)
- [x] Auth JWT/refresh, CSRF, Redis rate limit, MFA
- [x] RBAC e colaboradores com isolamento
- [x] Interface Next.js integrada
- [x] Testes e builds nativos; exceções de rede registradas abaixo
- [x] Guia de implantação e avaliação final
- [ ] Aguardar aprovação da Etapa 2

## Atualização: branch do Claude localizada
Consulta adicional `git ls-remote --heads origin` encontrou `claude/peopleflow-platform-arch-hu6btz` em `4d087c4a6a5b7ed15a177c67e9d52d001bbddae2`. A main permanece 8de21c6. Inspeção da branch em andamento sem checkout/merge/sobrescrita. Revisão inicial baseada só em main/anexos deve ser complementada com os arquivos reais desta branch. Etapa 1 local já tem builds/typecheck, 8 unitários, 20 integrações, 10 checks provisioning e 9 fluxos Chromium PASS; audit produção0; Docker limitado por DNS, nativeCLI migration pendente.

## Estado final para retomada — 2026-10-10

**Etapa 1 implementada para revisão. Não avançar à Etapa 2 sem aprovação explícita.** Nenhum deploy externo, push ou merge foi realizado. A main remota continua 8de21c6; checkout local permanece na branch `work`, com alterações da sessão não commitadas. Preserve-as. Depois do fetch da branch Claude, FETCH_HEAD aponta para 4d087c4; isso não altera HEAD.

### Código entregue
- `platform/`: workspaces `apps/api`, `apps/web`, `packages/contracts`, `packages/database`, scripts e infraestrutura. Next15.5.27/React19, Nest11, Prisma6.19.3 com PrismaPg, PostgreSQL/Redis.
- Auth real JWT cookies/refresh, revogação, RBAC, CSRF, rate limit Redis, Argon2id, TOTP criptografado/replay e recuperação de uso único. API proxy limita corpo, CSP nonce, IP de ingress autenticado por segredo em produção.
- Cadastro/lista/edição/paginação/filtros de colaboradores e dashboard com dados reais, empresa atual e segurança. EMPLOYEE somente registro próprio; MANAGER sem acesso a equipes até o modelo existir.
- Banco com RLS FORCE, FKs compostas, índices, auditoria append-only e role runtime sem BYPASSRLS. Provisionamento de produção create-only com senha via arquivo privado, confirmação de banco e auditoria; seed demo explicitamente bloqueado em produção.
- Dockerfiles/Compose/TLS ingress, migrações administrativas/grants, backup/restore/checksum/retenção, CI separado `platform.yml`.
- Entrega completa por tópico: `STAGE-1.md`; implantação: `DEPLOYMENT.md`; decisões: ADR-010; diagnóstico legado: `ASSESSMENT-LEGACY.md`.

### Última evidência executada
| Comando/ensaio | Resultado |
| --- | --- |
| `npm ci --ignore-scripts` com novo lock | PASS (scripts de install omitidos neste cloud; runtime/generated client validados depois) |
| `npm run db:generate` | PASS, client oficial Prisma6.19.3 |
| `npm run build` | PASS contratos, NestJS e Next15.5.27/standalone |
| `npm run typecheck` | PASS todos os workspaces, incluindo provisioning |
| `npm test` | 8 testes PASS |
| `npm run test:integration` | 20 testes PostgreSQL/Redis reais PASS, zero skips |
| `npm run test:provision` | 10 checks PostgreSQL PASS, inclusive produção/create-only/senha privada/recusa runtime |
| `npm run test:e2e` com Chromium151 | 9 fluxos PASS, zero skips (27,7s) |
| `npm audit --omit=dev` | 0 vulnerabilidades conhecidas |
| Repetição do seed | PASS: preserva registros/senhas; 2 tenants,2 empresas,4 usuários,6 colaboradores |
| Backup PostgreSQL17 custom + SHA256 e restore em banco novo | PASS; recusa repetir destino existente |
| Compose local/produção e scripts infra | Validação sintática PASS; sem implantação real |
| Teste exporter da branch Claude | 12 checks SQLite PASS (formato, não RLS) |
| `git diff --check` | PASS |

Playwright usa API compilada + Next standalone em bancos TEST, cria fixtures aleatórias e limpa somente seus registros. Tests não gravam traces/vídeos/telas de login ou códigos MFA. Foram exportadas exclusivamente telas sintéticas para revisão visual: `/workspace/reports/peopleflow-stage1/dashboard.png` e `mobile-dark.png`; ambas inspecionadas. A tabela móvel possui scroll interno, sem overflow da página.

Corrigidos durante validação: grants ausentes nas bases de teste; cast PostgreSQL `name`→text; timeout Argon2 real; serialização refresh entre abas; CSRF expirado inclusive no refresh; limpeza dos códigos em memória ao navegar/trocar conta; comprimento39 dos códigos de recuperação; limite incremental de corpo; spoofing do IP via proxy e vars Compose; override seguro de postcss8.5.29/deepmerge-ts8.0.2 (client/build/tests verificados). Falhas Playwright foram seletores ambíguos e espera da busca debounced, corrigidas mantendo assertions.

### Limitações concretas pendentes
1. A rede bloqueia `binaries.prisma.sh`; allowlist salva como rascunho pelo onboarding, não comprovadamente aplicada. A CLI nativa `prisma migrate deploy`/resolve não foi executada. Migration SQL inicial foi aplicada via psql às bases novas dev/test; `_prisma_migrations` não está registrada. Ao liberar rede, conferir schema e realizar baseline só nesses bancos locais já aplicados (guia); banco novo usa migrate deploy padrão. Nunca desabilitar TLS/checksum ou usar config generate-only para migrar.
2. Builds Docker tentados falharam por DNS do builder (Debian/proxy); foram interrompidos quando ficou claro o bloqueio. Imagens finais e smoke Compose precisam ser validados no ambiente de release. Builds nativos e E2E standalone passaram.
3. O novo workflow foi validado sintaticamente, mas ainda não rodou no GitHub. Nenhuma conta Vercel/Railway, TLS externo ou backup externo foi implantado.
4. O produto completo não está implementado/certificado. Módulos futuros e limitações LGPD/operação estão em STAGE-1.md. Nenhuma migração automática do legado foi feita, nem correção silenciosa de falhas do legado.

### Estado local e comandos seguros
Node24.19/npm11.9 disponíveis; use Node22–24. `platform/.env` privado contém somente configuração de desenvolvimento e dados sintéticos, não publicar/mostrar. Use `--cache /workspace/cloud-tools/npm-cache` se o cache padrão de npm estiver readonly. PostgreSQL17/Redis locais são iniciados por `/workspace/cloud-tools/start-services.sh` quando disponível. Dockerconfig/cache neste cloud precisam de diretório gravável (`DOCKER_CONFIG=/workspace/cloud-tools/docker`), mas isso não resolveu o DNS interno do builder.

Bancos locais: `peopleflow_stage1` (dev), `peopleflow_stage1_test` (isolado); role app `peopleflow_app`. `peopleflow_restore_infra_1791605031236` é banco sintético criado para ensaio; preservado para revisão. Backups desse ensaio em `/tmp/peopleflow-backup-validation-K8YgyY/backups`. Não fazer reset/drop de bancos para retomar. Os servidores temporários Playwright/API smoke foram encerrados; scripts dev podem iniciá-los quando necessário.

### Claude: estado confirmado
Ver `CLAUDE-COMMAND-REVIEW.md`. Branch remota localizada após consulta a todas as heads: `claude/peopleflow-platform-arch-hu6btz` SHA4d087c4,22 commits à frente da main,158 arquivos alterados. É a evolução **PHP/Laravel/Livewire**, não o projeto Next/Nest descrito nos anexos. Último commit: exporter MVP→Laravel, testado isoladamente em `/workspace/reviews/claude-cutover/` com12checksPASS.

O script anexado escreveu scaffold/contratos em `/home/claude/peopleflow`, diretório inexistente aqui; logs adicionais mostram PG/Redis preparados e Prisma7 generation falhando DNS. Nenhum desses comandos do anexo foi executado aqui. O projeto Next/Nest do Claude ainda precisa ser disponibilizado como commit/branch/pacote para revisão. Não substituir `platform/` pelos contratos incompatíveis do anexo nem fazer merge da branch Laravel sem uma decisão explícita sobre a transição.

Achados da branch Laravel registrados no relatório: tabelas novas de folha sem RLS, contexto PostgreSQL ausente no import CLI, risco de folha de outra empresa no exporter se vínculos legados inconsistentes e testes SQLite que não provam RLS. São achados estáticos, sem correção/merge; não representam a plataforma Stage1 nova que passou os testes PostgreSQL.

### Próximo passo exato
O usuário está revisando o trabalho do Claude e a Etapa1. Apresentar o relatório e aguardar sua decisão/ aprovação da Etapa2. Se chegar um commit/pacote novo do Claude, revisar primeiro sem sobrescrever alterações locais. Se for aprovada a próxima etapa, detalhar seu escopo/aceite antes de iniciar empresas/usuários/documentos/storage/admissão. Pendências operacionais de rede/migration/CI/Docker devem ser resolvidas antes de qualquer publicação em produção, dentro da autorização do usuário.
