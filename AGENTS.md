# Instruções de continuidade — dp-rh-saas / PeopleFlow

Leia `docs/implementation/CONTINUITY.md` antes de alterar o projeto. A plataforma TypeScript está na raiz deste repositório: `apps/`, `packages/`, `infra/` e `scripts/`. O legado PHP/Laravel e `mvp/` permanecem em `Misael192/Misael192.github.io`; não os importe nem faça merge de branches legadas sem uma decisão explícita.

O usuário exige entregas em etapas e aprovação antes da etapa seguinte. A Etapa 1 foi implementada; aguarde aprovação explícita para iniciar a Etapa 2. Atualize o registro de continuidade com decisões, evidências, pendências e próximo passo. Nunca marque módulos planejados como implementados. A transferência/publicação da Etapa 1 neste repositório foi autorizada; isso não autoriza implantação em produção.

Use o checkout isolado existente; não crie worktrees salvo pedido explícito. Preserve alterações preexistentes. Não exponha segredos em código/logs. Toda consulta privada exige contexto tenant/empresa e autorização. Teste com role PostgreSQL sem superuser/BYPASSRLS; mocks/SQLite não comprovam RLS. Dependências ficam fixadas no `package-lock.json`.

Execute os comandos npm na raiz. Siga `.env.example` e `docs/implementation/DEPLOYMENT.md`; mantenha a URL administrativa fora do processo HTTP. Não resete nem sobrescreva bancos para retomar. Os registros em `docs/implementation/history/` são evidências históricas; seus caminhos e instruções antigos não substituem este arquivo e o registro atual.
