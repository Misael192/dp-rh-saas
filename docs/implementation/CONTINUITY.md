# dp-rh-saas / PeopleFlow — registro de continuidade

## Objetivo e autorização

Desenvolver um SaaS DP/RH incremental, com Next.js 15, NestJS, Prisma, PostgreSQL e Redis, isolamento multiempresa, JWT/refresh/RBAC/2FA e interface própria. O usuário exige documentação, testes e aprovação antes de cada próxima etapa.

O usuário autorizou iniciar/transferir o projeto para `Misael192/dp-rh-saas`: “Joga todo o projeto ou inicia ele na dp-rh-saas”. Essa autorização inclui publicar os fontes da Etapa 1 nesse repositório. **A Etapa 2 aguarda aprovação. Não houve autorização para implantação em produção.**

## Local atual e procedência

- Repositório principal da plataforma: https://github.com/Misael192/dp-rh-saas.
- Checkout atual: `/workspace/dp-rh-saas`, branch `main`.
- O destino continha somente README no commit inicial `3ab170421a640ded40de4d5797fe1f2568c3b303`.
- A plataforma foi transferida da pasta `platform/` do checkout `Misael192/Misael192.github.io`, cuja base é `8de21c6db752eb2bd4611f757d78aeb4e09f29e9` (consulte o registro histórico para a revisão completa). A implementação local da Etapa 1 ainda não tinha commit nesse repositório.
- Fontes agora na raiz: `apps/api`, `apps/web`, `packages/contracts`, `packages/database`, `scripts`, `tests`, `infra`. Todos os comandos npm usam a raiz. Não criar outro `platform/`.
- O legado PHP/Laravel e MVP continuam no repositório anterior, preservados. Nenhum merge de branch do Claude nem importação de dados foi feito.
- Registro anterior preservado integralmente em [history/2026-10-10-original-workspace.md](history/2026-10-10-original-workspace.md). Caminhos/configuração daquele registro são históricos, não instruções atuais.
- Decisão de transferência: [ADR-011](../adr/ADR-011-repositorio-dp-rh-saas.md).

## Implementado — Etapa 1

Autenticação e sessões revogáveis, refresh rotativo, CSRF, rate limit Redis, RBAC, Argon2id, 2FA TOTP criptografado e recuperação de uso único. Cadastro/listagem/edição/filtros/paginação de colaboradores, dashboard com dados disponíveis, empresa atual e segurança. UI Next.js integrada, responsiva, temas claro/escuro, formulários validados e proxy same-origin.

Schema e migration inicial com FORCE RLS, escopo tenant/empresa, FKs compostas, índices e auditoria append-only. Role runtime sem superuser/BYPASSRLS. Provisionamento create-only com senha em arquivo privado e seed sintético bloqueado em produção. Infraestrutura Docker/Compose, ingresso TLS, backup/restauração, CI e testes reais PostgreSQL/Redis/Chromium.

Next 15.5.27, React 19, Nest 11, Prisma 6.19.3 com adapter oficial PrismaPg, Node 22–24. Versões resolvidas no lockfile. Consulte [STAGE-1.md](STAGE-1.md) para os dez tópicos de entrega e etapas futuras; [DEPLOYMENT.md](DEPLOYMENT.md) para operação.

## Transferência e validação no novo destino

Fontes, migrations, testes, infraestrutura e documentação copiados; caminhos do README, guias, READMEs internos e CI adaptados à raiz. Novo `AGENTS.md`, `.gitignore` e este registro criados. Nenhum `.env` privado, segredo, dump, `node_modules` ou build foi transferido ao Git.

A validação anterior pertence ao checkout original e está no histórico. **A execução abaixo foi repetida neste novo destino**, em 2026-10-11 UTC:

| Verificação | Resultado |
| --- | --- |
| `npm ci` com scripts habilitados | PASS, lockfile preservado |
| `npm run build` | PASS: Prisma oficial, contratos, Nest e Next15 standalone |
| `npm run typecheck` | PASS em todos os workspaces |
| `npm test` | 8 PASS |
| `npm run test:integration` | 20 PASS, PostgreSQL17/Redis reais e role sem bypass |
| `npm run test:provision` | 10 verificações PostgreSQL PASS |
| `npm run test:e2e` | 9 fluxos Chromium PASS, zero skips, 17,9s |
| `npm audit --omit=dev` | Zero vulnerabilidades conhecidas |
| CLI `prisma migrate deploy` nas bases novas dev/test + grants | PASS; `_prisma_migrations` registrada |
| Repetição de `npm run db:migrate` no banco novo dev | PASS: nenhuma migration pendente |
| Seed opt-in no banco dev novo | PASS: dados sintéticos, sem alterar bases antigas |
| Inventário de fontes/configuração/documentação | 130 arquivos revisados, sem secrets/builds privados |
| Docker build API runtime e web standalone | PASS, Dockerfiles iguais aos testados, CA opcional |
| Docker smoke API production | Readiness200 com PostgreSQL17/Redis7, colaboradores401 sem sessão, Argon2 nativo PASS |
| Docker smoke web production | Login200 com CSP nonce, BFF recusa ingresso ausente503 e encaminha CSRF200 com ingresso válido |
| Compose base/produção, scripts infra e `nginx -t` | PASS, validação sintática e certificado sintético |
| `npm run dev:api`/`dev:web` + fluxo HTTP | PASS: readiness, login pelo proxy, colaboradores persistidos, logout/revogação |

Durante a validação, o builder Docker esgotou o volume; foram removidos somente seus caches identificados e o `.next` derivado do checkout anterior. A migration no banco novo de teste falhou por espaço antes de criar tabelas/enums: conferido o schema vazio (somente `_prisma_migrations`), usada a CLI `migrate resolve --rolled-back`, e deploy repetido com sucesso. Nenhum banco existente foi resetado ou apagado.

O comando de desenvolvimento da API inicialmente não carregava o tsconfig de decorators ao executar na raiz. Corrigido o cwd de `dev:api` para `apps/api`; o Nest iniciou e readiness + login pelo proxy + listagem autenticada passaram. Dockerfiles passaram a aceitar CA de proxy via secret BuildKit opcional nos comandos npm, preservando TLS e sem armazenar o certificado na imagem.

Containers de smoke usaram usuário `node`, filesystem read-only, remoção de capabilities e `no-new-privileges`, sem publicar portas. A API recebeu somente a URL runtime, sem URL administrativa; a web não recebeu credenciais de banco. Caches/containers/rede criados durante a validação foram identificados para limpeza, preservando recursos preexistentes. No daemon VFS deste cloud, construa as imagens sequencialmente e confira o espaço livre: as cópias de layers consomem mais espaço que o tamanho lógico mostrado pelo BuildKit.

## Publicação no GitHub

Entrega publicada em `main` no commit [`66b8113122e22eaea2b4b1c0e0344a8a7fe51d37`](https://github.com/Misael192/dp-rh-saas/commit/66b8113122e22eaea2b4b1c0e0344a8a7fe51d37), com 130 arquivos e 12.352 linhas acrescentadas. `git push origin main` passou e `git ls-remote origin refs/heads/main` confirmou o mesmo SHA. Este registro recebe uma atualização posterior de evidências; consulte `git log` para o HEAD mais recente. O checkout de origem teve seu log atualizado localmente apontando para este destino, sem publicar alterações legadas.

O workflow foi adaptado à raiz e validado sintaticamente, mas ainda não teve execução observada no GitHub. Nenhum ambiente Vercel/Railway ou deploy de produção foi realizado. Não confundir publicação dos fontes com implantação do serviço.

## Estado operacional e cuidados para retomada

- Para reproduzir: leia `AGENTS.md`, este arquivo, `README.md`, `STAGE-1.md` e `DEPLOYMENT.md`; confira `git status` e preserve alterações existentes.
- Cloud atual tem Node24/npm11, PostgreSQL17/Redis locais via `/workspace/cloud-tools/start-services.sh`. Cache npm gravável: `/workspace/cloud-tools/npm-cache`. Nunca assumir que processos sobrevivem a outra tarefa.
- Configuração privada atual: `/workspace/cloud-tools/dp-rh-saas.env`, mode0600, fora do checkout. Use `export ENV_FILE=/workspace/cloud-tools/dp-rh-saas.env` neste snapshot antes dos scripts de dev/test. Foram reutilizadas configurações de desenvolvimento anteriores, com URLs ajustadas exclusivamente para os bancos novos `dp_rh_saas_dev` e `dp_rh_saas_test`; valores não registrados. Outras máquinas devem configurar `.env` privado usando `.env.example` ou bindings seguros.
- Bancos existentes `peopleflow_stage1`/`peopleflow_stage1_test` receberam SQL inicial diretamente com psql. Não possuem baseline Prisma registrada. **Não executar migrate deploy nesses bancos existentes sem conferir o schema e registrar a baseline conforme o guia. Não usar reset/drop.** Banco novo usa deploy normal.
- CLI nativa e builds Docker foram validados nas bases/imagens novas. Ainda verificar o resultado do CI GitHub e o ciclo completo Compose/release/backup na infraestrutura definitiva. Baseline das bases antigas segue pendente caso sejam reutilizadas.
- Backup/restauração anterior validado em banco sintético novo; detalhes no histórico. Sem deployment Vercel/Railway, domínio/TLS externo ou backup externo configurado.
- A branch Claude `claude/peopleflow-platform-arch-hu6btz` em `4d087c4a6a5b7ed15a177c67e9d52d001bbddae2` pertence ao repositório anterior e evolui Laravel/Livewire. Sua revisão está em `CLAUDE-COMMAND-REVIEW.md`; não é a plataforma transferida.

## Próximo passo exato

**Aguardar aprovação explícita da Etapa 2.** A Etapa 1 está publicada no novo repositório e o registro de origem aponta para ele. Ao receber a aprovação, detalhar primeiro escopo/aceite da próxima entrega; preserve o histórico e todas as alterações locais. Antes de qualquer implantação de produção, confirmar CI, credenciais/ingresso, backup externo, restauração e operação no destino definitivo. Não marcar módulos planejados como entregues.
