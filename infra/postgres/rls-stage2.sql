\set ON_ERROR_STOP on
-- Etapa 2 — RLS das tabelas de documentos/armazenamento.
-- Idempotente: pode ser aplicado em bancos já migrados (inclusive os antigos
-- que receberam SQL diretamente) sem duplicar policies. Deve permanecer
-- sincronizado com o bloco DO $$ da migration add_stage2_documents.
BEGIN;

DO $rls$
DECLARE
  scoped_table text;
  policy_name  text;
BEGIN
  FOREACH scoped_table IN ARRAY ARRAY['file_objects', 'document_templates', 'documents', 'document_versions', 'document_signatures']
  LOOP
    policy_name := scoped_table || '_company_scope';
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', scoped_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', scoped_table);
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = scoped_table AND policyname = policy_name) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid AND company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid AND company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid)',
        policy_name, scoped_table
      );
    END IF;
  END LOOP;
END
$rls$;

COMMIT;
