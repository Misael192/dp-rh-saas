# ADR-011 — Repositório dedicado para o SaaS

Data: 2026-10-10. Estado: aceito por solicitação do usuário.

## Contexto

A Etapa 1 foi desenvolvida como monorepo `platform/` no checkout de `Misael192/Misael192.github.io`, que também contém o legado PHP/Laravel. O usuário pediu: “Joga todo o projeto ou inicia ele na dp-rh-saas”. O destino `Misael192/dp-rh-saas` estava em seu commit inicial, contendo somente README.

## Decisão

Transferir todos os fontes, contratos, migrations, testes, infraestrutura e documentação da plataforma TypeScript para a raiz de `dp-rh-saas`. Adaptar caminhos do CI e dos guias; preservar o histórico inicial do destino. Arquivos privados, dependências instaladas, builds, dumps e credenciais ficam fora do Git.

Conservar o diagnóstico do legado e o registro anterior como evidências históricas, com referências ao repositório original. Criar `AGENTS.md` e um registro de continuidade atual para o novo destino. A Etapa 2 continua dependendo de aprovação; a publicação do código no GitHub não implica implantação em produção.

## Consequências

`dp-rh-saas` passa a ser o local de desenvolvimento da plataforma. Comandos npm e contexto Docker usam sua raiz; o Root Directory na Vercel é `apps/web`. A origem permanece preservada, sem merge ou conversão automática dos dados legados. Não há nova cópia de produção nem nova credencial incluída no repositório.
