#!/usr/bin/env bash
set -euo pipefail
: "${POSTGRES_DB:?POSTGRES_DB is required}"
: "${POSTGRES_USER:?POSTGRES_USER is required}"
: "${RUNTIME_DB_PASSWORD:?RUNTIME_DB_PASSWORD is required}"
# psql quotes credentials as SQL literals; do not interpolate secrets into SQL.
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --set ON_ERROR_STOP=1 <<'SQL'
\getenv runtime_password RUNTIME_DB_PASSWORD
\getenv database_name POSTGRES_DB
SELECT 'CREATE ROLE peopleflow_app' WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'peopleflow_app'
) \gexec
ALTER ROLE peopleflow_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD :'runtime_password';
ALTER ROLE peopleflow_app SET statement_timeout = '10s';
ALTER ROLE peopleflow_app SET idle_in_transaction_session_timeout = '10s';
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database_name" TO peopleflow_app;
SQL
