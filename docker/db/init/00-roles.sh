#!/bin/sh
# Bootstrap the database role skeleton. Runs once, on first initialisation of
# the PostgreSQL data volume. Passwords come from the compose environment;
# grants and schema privileges live in migrations (API-002 onwards) so they
# are versioned with the schema they protect.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v auth_pass="$POSTGREST_AUTHENTICATOR_PASSWORD" \
  -v migrator_pass="$MIGRATOR_PASSWORD" \
  -v formula_pass="$FORMULA_WRITER_PASSWORD" \
  -v sandbox_pass="$PIPELINE_SANDBOX_PASSWORD" \
  -v db_name="$POSTGRES_DB" <<'SQL'
-- PostgREST request roles (switched to by authenticator per request).
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
-- External API credentials (API-005) authenticate as this role; RLS grants
-- it only the workspace-scoped access the credential's scopes allow.
CREATE ROLE api_client NOLOGIN NOINHERIT;

-- PostgREST connection role: the only credential PostgREST holds.
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD :'auth_pass';
GRANT anon, authenticated, api_client TO authenticator;

-- Migration role: owns schemas and tables so DDL never runs as a superuser
-- in normal development.
-- CREATEROLE lets api.create_sql_login mint the personal read-only SQL logins
-- stewards use for reporting; it grants no data access.
CREATE ROLE migrator LOGIN NOINHERIT CREATEROLE PASSWORD :'migrator_pass';

-- Trusted formula persistence is callable only after an owner connection
-- deliberately assumes this capability role.
CREATE ROLE formula_writer NOLOGIN NOINHERIT;
GRANT formula_writer TO migrator WITH ADMIN OPTION;
CREATE ROLE formula_runtime LOGIN NOINHERIT PASSWORD :'formula_pass';
GRANT formula_writer TO formula_runtime;

-- Legacy AUTO-02 role, kept so existing databases and grants stay valid. The
-- executor no longer switches into it: that was a same-session role switch a
-- statement could undo.
CREATE ROLE pipeline_worker NOLOGIN NOINHERIT;

-- Pipeline SQL sandbox: transform SQL runs on its own connection that logs in
-- as this role. It owns nothing, holds no grants, is a member of no role and
-- cannot create objects outside its own temp schema, so a statement that
-- resets the session role lands on the same unprivileged login. The caps
-- below are GUCs only a superuser can change, so a statement cannot lift them.
CREATE ROLE pipeline_sandbox LOGIN NOINHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 32
  PASSWORD :'sandbox_pass';
ALTER ROLE pipeline_sandbox SET temp_file_limit = '1GB';
ALTER ROLE pipeline_sandbox SET statement_timeout = '90s';
ALTER ROLE pipeline_sandbox SET idle_session_timeout = '10min';
ALTER ROLE pipeline_sandbox SET search_path = pg_temp;

-- Reporting access. reporting_reader is the group every personal SQL login
-- joins; it can only SELECT from the reporting views. reporting_owner owns
-- those views and reads the base tables as a member of authenticated, so row
-- level security applies to it exactly as it does through PostgREST.
CREATE ROLE reporting_reader NOLOGIN NOINHERIT;
CREATE ROLE reporting_owner NOLOGIN;
GRANT authenticated TO reporting_owner;
GRANT reporting_reader TO migrator WITH ADMIN OPTION;
GRANT reporting_owner TO migrator;

-- Narrowly controlled service operations (AUTH-003 token exchange, workers).
CREATE ROLE service_role NOLOGIN NOINHERIT;

-- migrator owns the database: DDL (including public-schema hygiene and the
-- drizzle bookkeeping schema) runs as a non-superuser.
ALTER DATABASE :db_name OWNER TO migrator;

-- The exposed surface PostgREST loads at startup. Migrations own its
-- contents; this only lets PostgREST boot before the first migration.
CREATE SCHEMA IF NOT EXISTS api AUTHORIZATION migrator;
GRANT USAGE ON SCHEMA api TO anon, authenticated, api_client;
SQL
