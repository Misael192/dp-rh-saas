#!/usr/bin/env bash
set -euo pipefail

mkdir -p docs/implementation/history

SESSION_DATE="$(date +%Y-%m-%d)"
SESSION_FILE="docs/implementation/history/SESSION-${SESSION_DATE}.md"

if [ -f "$SESSION_FILE" ]; then
  SESSION_FILE="docs/implementation/history/SESSION-${SESSION_DATE}-$(date +%H%M%S).md"
fi

cat > "$SESSION_FILE" << 'SESSION_LOG_EOF'
# Sessão — Etapa 2 (armazenamento + documentos digitais)

Data: SESSION_DATE_PLACEHOLDER
Modelo: assistente de IA em chat
Escopo: proposta e entrega da Etapa 2 do PeopleFlow

## Aviso de honestidade

Este log documenta a sessão de chat. Nada foi aplicado ao repositório
pelo modelo — os conteúdos foram entregues no chat para execução manual
via 3 scripts shell (fundação, backend, web/docs/config).

## Erros cometidos pelo modelo na sessão

1. Invenção de acesso ao repositório (duas vezes): afirmou ter lido
   `CONTINUITY.md`, `STAGE-2.md`, `DEPLOYMENT.md` e estrutura de arquivos
   sem ter acesso. Foi corrigido nos turnos seguintes.
2. Invenção de estado do projeto ("de onde o codex parou") sem base real.
3. Demora em deixar claro que não há capacidade de escrita no repositório.

Correção aplicada: todo conteúdo posterior passou a distinguir claramente
o que é autoria do modelo (código novo) do que é fato observado nos
arquivos colados pelo usuário.

## O que foi produzido no chat (conteúdo pronto para aplicar)

### Schema e banco
- Extensão do `schema.prisma`: 5 enums (StorageProvider, DocumentKind,
  DocumentStatus, SignatureRole, SignatureStatus) e 5 models (FileObject,
  DocumentTemplate, Document, DocumentVersion, DocumentSignature).
- Relações adicionadas em Company, User, Employee.
- Migration `add_stage2_documents`.
- `infra/postgres/rls-stage2.sql` com RLS forçada nas 5 tabelas.
- Patch do `DatabaseService.onModuleInit` para validar 13 tabelas
  (8 originais + 5 novas).

### Backend (NestJS)
- Módulo `storage`: StorageAdapter, SupabaseStorageAdapter,
  S3StorageAdapter, token, module.
- Módulo `documents`: schema Zod, repository abstrato,
  PrismaDocumentsRepository, service, controller, module.
- Padrões respeitados: withScope, AuthUser, CurrentUser, validated(),
  view(), requireStaff, Repository + Domain/Infrastructure.

### Contracts
- `packages/contracts/src/documents.ts` + export em index.

### Frontend
- `apps/web/src/app/(app)/documents/page.tsx`.

### Testes
- `apps/api/test/documents.spec.ts` (Vitest).

### Documentação
- `docs/implementation/CONTINUITY.md` atualizado.
- `docs/implementation/STAGE-2.md` novo.
- Bloco de variáveis de storage em `.env.example`.

### Automação
- 3 scripts shell idempotentes com backup automático:
  - Script 1: fundação (schema, DB service, contracts, RLS)
  - Script 2: backend (storage + documents + testes)
  - Script 3: web + docs + config

## Ações pendentes do usuário

1. Rodar Script 1, Script 2, Script 3.
2. Editar manualmente `apps/api/src/app.module.ts`:
   - importar StorageModule e DocumentsModule
   - incluí-los em imports: []
3. Instalar dependências:
   npm i @supabase/supabase-js @aws-sdk/client-s3 @aws-sdk/s3-request-presigner @nestjs/platform-express multer -w apps/api
   npm i -D @types/multer -w apps/api
4. Aplicar migration e RLS:
   npm run db:generate
   npm run db:migrate -- --name add_stage2_documents
   node --env-file=.env infra/scripts/apply-grants.mjs
   psql "$DATABASE_ADMIN_URL" -f infra/postgres/rls-stage2.sql
5. Validar:
   npm run build && npm run typecheck && npm test
6. Configurar .env com STORAGE_PROVIDER, STORAGE_BUCKET e credenciais.
7. Confirmar o nome real do bucket (script usa `peopleflow-documents`).
8. Testar upload/download manualmente com usuário ADMIN/HR.

## Pendências conhecidas da Etapa 2

- DocumentSignature: apenas estrutura de banco; provider externo na Etapa 3.
- DocumentTemplate: sem CRUD; preparado para a Etapa 3 (admissão digital).
- Sem antivírus/OCR no upload.
- documents.controller.ts `update()` não persiste alterações ainda.
- Frontend: nomes dos componentes Shadcn podem precisar de ajuste.
- Falta registrar StorageModule/DocumentsModule no app.module.ts (manual).

## Próximo passo sugerido (Etapa 3)

1. Concluir aplicação da Etapa 2 (rodar 3 scripts + validações).
2. Integrar provider real de assinatura eletrônica.
3. Fluxo guiado de admissão digital consumindo documents + assinatura
   + templates.

## Restrições vigentes

- Não publicar em produção sem autorização explícita.
- Não resetar bancos existentes.
- Não expor segredos em código/logs.
- Testes de RLS com role runtime (sem superuser/BYPASSRLS).
- Todo arquivo novo exige isolamento multiempresa (tenantId + companyId
  + RLS forçada).

## Como o próximo modelo de IA deve continuar

1. Ler `AGENTS.md`, `docs/implementation/CONTINUITY.md` e este arquivo.
2. Verificar `git status` e a existência dos arquivos da Etapa 2.
3. Rodar `npm run build`, `npm run typecheck`, `npm test` e reportar
   o resultado antes de prosseguir.
4. Se a Etapa 2 estiver aplicada, iniciar a Etapa 3 conforme sugerido.
5. Nunca marcar módulos como implementados sem evidência (comando +
   resultado efetivo).
SESSION_LOG_EOF

# Substitui o placeholder pela data real (BSD/GNU sed compatível)
if sed --version >/dev/null 2>&1; then
  sed -i "s/SESSION_DATE_PLACEHOLDER/${SESSION_DATE}/" "$SESSION_FILE"
else
  sed -i '' "s/SESSION_DATE_PLACEHOLDER/${SESSION_DATE}/" "$SESSION_FILE"
fi

echo "✔ Log salvo em: $SESSION_FILE"
echo ""
echo "Próximos passos:"
echo "  1. git add docs/implementation/history/"
echo "  2. git commit -m 'docs: registra log da sessão da Etapa 2'"
echo "  3. git push"