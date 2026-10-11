\set ON_ERROR_STOP on
BEGIN;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO peopleflow_app;
GRANT USAGE ON TYPE "Role", "EmployeeStatus" TO peopleflow_app;
REVOKE ALL ON tenants, companies, users, auth_sessions, mfa_credentials,
  mfa_recovery_codes, employees, audit_logs FROM peopleflow_app;
GRANT SELECT ON tenants, companies TO peopleflow_app;
GRANT SELECT, INSERT, UPDATE ON users, auth_sessions, mfa_credentials,
  mfa_recovery_codes, employees TO peopleflow_app;
GRANT DELETE ON mfa_recovery_codes TO peopleflow_app;
GRANT SELECT, INSERT ON audit_logs TO peopleflow_app;
-- Etapa 2 — storage foundation. Grants for the five new tables/types follow the
-- same principle as Stage 1: explicit objects only, no global privileges.
GRANT USAGE ON TYPE "StorageProvider", "DocumentKind", "DocumentStatus", "SignatureRole", "SignatureStatus" TO peopleflow_app;
REVOKE ALL ON file_objects, document_templates, documents, document_versions, document_signatures FROM peopleflow_app;
GRANT SELECT, INSERT, UPDATE ON file_objects, document_templates, documents, document_versions, document_signatures TO peopleflow_app;
-- UUID identifiers require no sequence privileges. Future migrations must
-- explicitly grant only the tables/types/sequences their feature needs.
COMMIT;
