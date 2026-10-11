-- PostgreSQL 16+. Runtime roles and grants are managed separately by infra/.
-- This migration intentionally contains no role passwords or global grants.

CREATE TYPE "Role" AS ENUM ('ADMIN', 'HR', 'MANAGER', 'EMPLOYEE');
CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED');

CREATE TABLE "tenants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tenants_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT "tenants_name_not_blank" CHECK (length(btrim("name")) > 0)
);

CREATE TABLE "companies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "companies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "companies_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    CONSTRAINT "companies_name_not_blank" CHECK (length(btrim("name")) > 0)
);

CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'EMPLOYEE',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "users_email_normalized" CHECK ("email" = lower(btrim("email"))),
    CONSTRAINT "users_name_not_blank" CHECK (length(btrim("name")) > 0),
    CONSTRAINT "users_token_version_nonnegative" CHECK ("token_version" >= 0)
);

CREATE TABLE "auth_sessions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "refresh_token_hash" VARCHAR(128) NOT NULL,
    "previous_refresh_token_hashes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "rotation_counter" INTEGER NOT NULL DEFAULT 0,
    "token_version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "auth_sessions_rotation_counter_nonnegative" CHECK ("rotation_counter" >= 0),
    CONSTRAINT "auth_sessions_token_version_nonnegative" CHECK ("token_version" >= 0),
    CONSTRAINT "auth_sessions_expiration_valid" CHECK ("expires_at" > "created_at"),
    CONSTRAINT "auth_sessions_refresh_history_bounded" CHECK (cardinality("previous_refresh_token_hashes") <= 2048)
);

CREATE TABLE "mfa_credentials" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "secret_encrypted" TEXT,
    "pending_secret_encrypted" TEXT,
    "last_used_step" BIGINT,
    CONSTRAINT "mfa_credentials_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mfa_credentials_step_nonnegative" CHECK ("last_used_step" IS NULL OR "last_used_step" >= 0)
);

CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" VARCHAR(128) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employees" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID,
    "registration" VARCHAR(40) NOT NULL,
    "full_name" VARCHAR(160) NOT NULL,
    "email" VARCHAR(254),
    "job_title" VARCHAR(120) NOT NULL,
    "department_name" VARCHAR(120) NOT NULL,
    "hired_at" DATE NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "employees_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employees_registration_not_blank" CHECK (length(btrim("registration")) > 0),
    CONSTRAINT "employees_full_name_not_blank" CHECK (length(btrim("full_name")) > 0),
    CONSTRAINT "employees_job_title_not_blank" CHECK (length(btrim("job_title")) > 0),
    CONSTRAINT "employees_department_name_not_blank" CHECK (length(btrim("department_name")) > 0)
);

CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tenant_id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "user_id" UUID,
    "action" VARCHAR(100) NOT NULL,
    "entity_id" UUID,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "audit_logs_action_not_blank" CHECK (length(btrim("action")) > 0),
    CONSTRAINT "audit_logs_metadata_object" CHECK (jsonb_typeof("metadata") = 'object')
);

CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE UNIQUE INDEX "companies_tenant_id_id_key" ON "companies"("tenant_id", "id");
CREATE UNIQUE INDEX "companies_tenant_id_slug_key" ON "companies"("tenant_id", "slug");
CREATE INDEX "companies_tenant_id_is_active_idx" ON "companies"("tenant_id", "is_active");
CREATE UNIQUE INDEX "users_tenant_id_company_id_id_key" ON "users"("tenant_id", "company_id", "id");
CREATE UNIQUE INDEX "users_tenant_id_company_id_email_key" ON "users"("tenant_id", "company_id", "email");
CREATE INDEX "users_tenant_id_company_id_is_active_idx" ON "users"("tenant_id", "company_id", "is_active");
CREATE UNIQUE INDEX "auth_sessions_tenant_id_company_id_id_key" ON "auth_sessions"("tenant_id", "company_id", "id");
CREATE INDEX "auth_sessions_tenant_id_company_id_user_id_revoked_at_idx" ON "auth_sessions"("tenant_id", "company_id", "user_id", "revoked_at");
CREATE INDEX "auth_sessions_expires_at_idx" ON "auth_sessions"("expires_at");
CREATE UNIQUE INDEX "mfa_credentials_user_id_key" ON "mfa_credentials"("user_id");
CREATE UNIQUE INDEX "mfa_credentials_tenant_id_company_id_id_key" ON "mfa_credentials"("tenant_id", "company_id", "id");
CREATE UNIQUE INDEX "mfa_credentials_tenant_id_company_id_user_id_key" ON "mfa_credentials"("tenant_id", "company_id", "user_id");
CREATE UNIQUE INDEX "mfa_recovery_codes_tenant_id_company_id_id_key" ON "mfa_recovery_codes"("tenant_id", "company_id", "id");
CREATE UNIQUE INDEX "mfa_recovery_codes_tenant_id_company_id_user_id_code_hash_key" ON "mfa_recovery_codes"("tenant_id", "company_id", "user_id", "code_hash");
CREATE INDEX "mfa_recovery_codes_tenant_id_company_id_user_id_used_at_idx" ON "mfa_recovery_codes"("tenant_id", "company_id", "user_id", "used_at");
CREATE UNIQUE INDEX "employees_tenant_id_company_id_id_key" ON "employees"("tenant_id", "company_id", "id");
CREATE UNIQUE INDEX "employees_tenant_id_company_id_registration_key" ON "employees"("tenant_id", "company_id", "registration");
CREATE UNIQUE INDEX "employees_tenant_id_company_id_user_id_key" ON "employees"("tenant_id", "company_id", "user_id");
CREATE INDEX "employees_tenant_id_company_id_status_idx" ON "employees"("tenant_id", "company_id", "status");
CREATE INDEX "employees_tenant_id_company_id_hired_at_idx" ON "employees"("tenant_id", "company_id", "hired_at");
CREATE INDEX "employees_tenant_id_company_id_full_name_idx" ON "employees"("tenant_id", "company_id", "full_name");
CREATE UNIQUE INDEX "audit_logs_tenant_id_company_id_id_key" ON "audit_logs"("tenant_id", "company_id", "id");
CREATE INDEX "audit_logs_tenant_id_company_id_created_at_idx" ON "audit_logs"("tenant_id", "company_id", "created_at");
CREATE INDEX "audit_logs_tenant_id_company_id_user_id_created_at_idx" ON "audit_logs"("tenant_id", "company_id", "user_id", "created_at");
CREATE INDEX "audit_logs_tenant_id_company_id_entity_id_idx" ON "audit_logs"("tenant_id", "company_id", "entity_id");

-- A company-scoped foreign key includes BOTH identity dimensions. An ordinary
-- FK on UUID alone does not prove that the related row belongs to this company.
ALTER TABLE "companies" ADD CONSTRAINT "companies_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_tenant_id_company_id_user_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "user_id") REFERENCES "users"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "mfa_credentials" ADD CONSTRAINT "mfa_credentials_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "mfa_credentials" ADD CONSTRAINT "mfa_credentials_tenant_id_company_id_user_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "user_id") REFERENCES "users"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_tenant_id_company_id_user_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "user_id") REFERENCES "users"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "employees" ADD CONSTRAINT "employees_tenant_id_company_id_user_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "user_id") REFERENCES "users"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_company_id_fkey" FOREIGN KEY ("tenant_id", "company_id") REFERENCES "companies"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_company_id_user_id_fkey" FOREIGN KEY ("tenant_id", "company_id", "user_id") REFERENCES "users"("tenant_id", "company_id", "id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Tenant contains only public login-routing metadata. Runtime gets SELECT only.
-- Administrative provisioning can use explicit local scope even under FORCE.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenants_public_routing" ON "tenants" FOR SELECT USING (true);
CREATE POLICY "tenants_scoped_insert" ON "tenants" FOR INSERT WITH CHECK ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "tenants_scoped_update" ON "tenants" FOR UPDATE USING ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "tenants_scoped_delete" ON "tenants" FOR DELETE USING ("id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Company is resolved after tenant lookup and before user/password lookup.
ALTER TABLE "companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "companies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "companies_tenant_scope" ON "companies" USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Private tables fail closed when tenant OR company context is absent. Context
-- is SET LOCAL inside the same transaction that performs these queries.
DO $policies$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['users', 'auth_sessions', 'mfa_credentials', 'mfa_recovery_codes', 'employees']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid AND company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid) WITH CHECK (tenant_id = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid AND company_id = NULLIF(current_setting(''app.company_id'', true), '''')::uuid)',
      table_name || '_company_scope', table_name
    );
  END LOOP;
END
$policies$;

-- Audit is append-only for runtime. Neither UPDATE nor DELETE has an RLS policy.
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY "audit_logs_scoped_read" ON "audit_logs" FOR SELECT USING ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND "company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid);
CREATE POLICY "audit_logs_scoped_append" ON "audit_logs" FOR INSERT WITH CHECK ("tenant_id" = NULLIF(current_setting('app.tenant_id', true), '')::uuid AND "company_id" = NULLIF(current_setting('app.company_id', true), '')::uuid);
