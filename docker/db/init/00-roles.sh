#!/bin/sh
# Bootstrap the database role skeleton. Runs once, on first initialisation of
# the PostgreSQL data volume. Passwords come from the compose environment;
# grants and schema privileges live in migrations (API-002 onwards) so they
# are versioned with the schema they protect.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v auth_pass="$POSTGREST_AUTHENTICATOR_PASSWORD" \
  -v migrator_pass="$MIGRATOR_PASSWORD" \
  -v db_name="$POSTGRES_DB" <<'SQL'
-- PostgREST request roles (switched to by authenticator per request).
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;

-- PostgREST connection role: the only credential PostgREST holds.
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD :'auth_pass';
GRANT anon, authenticated TO authenticator;

-- Migration role: owns schemas and tables so DDL never runs as a superuser
-- in normal development.
CREATE ROLE migrator LOGIN NOINHERIT PASSWORD :'migrator_pass';

-- Narrowly controlled service operations (AUTH-003 token exchange, workers).
CREATE ROLE service_role NOLOGIN NOINHERIT;

-- migrator owns the database: DDL (including public-schema hygiene and the
-- drizzle bookkeeping schema) runs as a non-superuser.
ALTER DATABASE :db_name OWNER TO migrator;

-- The exposed surface PostgREST loads at startup. Migrations own its
-- contents; this only lets PostgREST boot before the first migration.
CREATE SCHEMA IF NOT EXISTS api AUTHORIZATION migrator;
GRANT USAGE ON SCHEMA api TO anon, authenticated;
SQL
