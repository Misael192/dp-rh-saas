-- Etapa 2 — fundação de armazenamento e documentos digitais.
-- PostgreSQL 15+. Nenhuma senha de role ou grant global neste arquivo; os
-- grants de runtime ficam em infra/postgres/apply-runtime-grants.sql e o SQL
-- adicional de RLS versionado fica em infra/postgres/rls-stage2.sql (idempotente).

CREATE TYPE "StorageProvider" AS ENUM ('SUPABASE', 'S3');
CREATE TYPE "DocumentKind" AS ENUM ('CONTRACT', 'TERM_SHEET', 'POLICY', 'PAYSLIP', 'DECLARATION', 'OTHER');
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE "SignatureRole" AS ENUM ('EMPLOYEE', 'EMPLOYER', 'WITNESS');
CREATE TYPE "SignatureStatus" AS ENUM ('PENDING', 'SIGNED', 'REJECTED');

CREATE TABLE "file_objects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "uploaded_by_id" UUID,
    "provider" "StorageProvider" NOT NULL,
    "bucket" VARCHAR(120) NOT NULL,
    "object_key" VARCHAR(500) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(120) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "file_objects_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "file_objects_bucket_not_blank" CHECK (length(btrim("bucket")) > 0),
    CONSTRAINT "file_objects_object_key_not_blank" CHECK (length(btrim("object_key")) > 0),
    CONSTRAINT "file_objects_original_name_not_blank" CHECK (length(btrim("original_name")) > 0),
    CONSTRAINT "file_objects_size_positive" CHECK ("size_bytes" > 0),
    CONSTRAINT "file_objects_sha256_format" CHECK ("sha256" ~ '^[a-f0-9]{64}$')
);

CREATE TABLE "document_templates" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "code" VARCHAR(60) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "description" VARCHAR(500),
    "default_file_name" VARCHAR(255) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_templates_code_format" CHECK ("code" ~ '^[A-Z0-9]+(_[A-Z0-9]+)*$'),
    CONSTRAINT "document_templates_name_not_blank" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "document_templates_file_name_not_blank" CHECK (length(btrim("default_file_name")) > 0)
);

CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "employee_id" UUID,
    "template_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "current_version_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "documents_title_not_blank" CHECK (length(btrim("title")) > 0)
);

CREATE TABLE "document_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "file_object_id" UUID NOT NULL,
    "note" VARCHAR(500),
    "created_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_versions_number_positive" CHECK ("version_number" >= 1)
);

CREATE TABLE "document_signatures" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "signer_user_id" UUID,
    "signer_name" VARCHAR(160) NOT NULL,
    "role" "SignatureRole" NOT NULL,
    "status" "SignatureStatus" NOT NULL DEFAULT 'PENDING',
    "signed_at" TIMESTAMPTZ(3),
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_signatures_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_signatures_name_not_blank" CHECK (length(btrim("signer_name")) > 0),
    CONSTRAINT "document_signatures_evidence_object" CHECK (jsonb_typeof("evidence") = 'object'),
    CONSTRAINT "document_signatures_signed_at_consistency" CHECK (
      ("status" = 'SIGNED' AND "signed_at" IS NOT NULL)
      OR ("status" <> 'SIGNED' AND "signed_at" IS NULL)
    )
);

CREATE UNIQUE INDEX "file_objects_tenant_id_company_id_id_key" ON "file_objects"("tenant_id", "company_id", "id");
CREATE UNIQUE INDEX "file_objects_tenant_id_company_id_provider_bucket_object_key_key" ON "file_objects"("tenant_id", "company_id", "provider", "bucket", "object_key");
CREATE INDEX "file_objects_tenant_id_company_id_created_at_idx" ON "file_objects"("tenant_id", "company_id", "created_at");
CREATE UNIQUE INDEX "document_templates_tenant_id_company_id_id_key" ON "document_templates"("tenant_id", "company_id", "id");
CREATE UNIQUE INDEX "document_templates_tenant_id_company_id_code_key" ON "document_templates"("tenant_id", "company_id", "code");
CREATE INDEX "document_templates_tenant_id_company_id_kind_idx" ON "document_templates"("tenant_id", "company_id", "kind");
CREATE UNIQUE INDEX "documents_tenant_id_company_id_id_key" ON "documents"("tenant_id", "company_id", "id");
CREATE UNIQUE INDEX "documents_tenant_id_company_id_current_version_id_key" ON "documents"("tenant_id", "company_id", "current_version_id");
CREATE INDEX "documents_tenant_id_company_id_status_idx" ON "documents"("tenant_id", "company_id", "status");
CREATE INDEX "documents_tenant_id_company_id_employee_id_idx" ON "documents"("tenant_id", "company_id", "employee_id");
CREATE INDEX "documents_tenant_id_company_id_kind_idx" ON "documents"("tenant_id", "company_id", "kind");
CREATE UNIQUE INDEX "document_versions_tenant_id_company_id_id_key" ON "document_versions"("tenant_id", "company_id", "id");
CREATE UNIQUE INDEX "document_versions_tenant_id_company_id_document_id_version_number_key" ON "document_versions"("tenant_id", "company_id", "document_id", "version_number");
CREATE UNIQUE INDEX "document_versions_tenant_id_company_id_file_object_id_key" ON "document_versions"("tenant_id", "company_id", "file_object_id");
CREATE INDEX "document_versions_tenant_id_company_id_document_id_idx" ON "document_versions"("tenant_id", "company_id", "document_id");
CREATE UNIQUE INDEX "document_signatures_tenant_id_company_id_id_key" ON "document_signatures"("tenant_id", "company_id", "id");
CREATE UNIQUE INDEX "document_signatures_tenant_id_company_id_version_id_role_signer_name_key" ON "document_signatures"("tenant_id", "company_id", "version_id", "role", "signer_name");
CREATE INDEX "document_signatures_tenant_id_company_id_document_id_idx" ON "document_signatures"("tenant_id", "company_id", "document_id");
CREATE INDEX "document_signatures_tenant_id_company_id_status_idx" ON "document_signatures"("tenant_id", "company_id", "status");

-- FK composta: inclui ambas as dimensões de identidade; uma FK simples em UUID
-- não prova que a linha referenciada pertence à mesma empresa.
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "file_objects" ADD CONSTRAINT "file_objects_tenant_id_company_id_uploaded_by_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "uploaded_by_id") REFERENCES "users"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_company_id_employee_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "employee_id") REFERENCES "employees"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "documents" ADD CONSTRAINT "documents_tenant_id_company_id_template_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "template_id") REFERENCES "document_templates"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_tenant_id_company_id_document_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "document_id") REFERENCES "documents"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_tenant_id_company_id_file_object_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "file_object_id") REFERENCES "file_objects"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_tenant_id_company_id_document_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "document_id") REFERENCES "documents"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_tenant_id_company_id_version_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "version_id") REFERENCES "document_versions"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "document_signatures" ADD CONSTRAINT "document_signatures_tenant_id_company_id_signer_user_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "signer_user_id") REFERENCES "users"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- documents.current_version_id referencia document_versions; a dependência é
-- resolvida na transação da aplicação (versão criada antes do ponteiro).
ALTER TABLE ONLY "documents" ADD CONSTRAINT "documents_tenant_id_company_id_current_version_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "current_version_id") REFERENCES "document_versions"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- RLS ENABLE/FORCE com policies base usando app.tenant_id/app.company_id.
-- O arquivo infra/postgres/rls-stage2.sql repete este bloco de forma
-- idempotente para bancos já migrados; ambos devem permanecer sincronizados.
DO $policies$
DECLARE
  scoped_table text;
BEGIN
  FOREACH scoped_table IN ARRAY ARRAY['file_objects', 'document_templates', 'documents', 'document_versions', 'document_signatures']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', scoped_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', scoped_table);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid AND company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid AND company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid)',
      scoped_table || '_company_scope', scoped_table
    );
  END LOOP;
END
$policies$;
