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
-- UUID identifiers require no sequence privileges. Future migrations must
-- explicitly grant only the tables/types/sequences their feature needs.
COMMIT;
