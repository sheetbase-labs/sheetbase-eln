#!/bin/sh
# Bootstrap the role skeleton PostgREST connects with. Runs once, on first
# initialisation of the PostgreSQL data volume. Full privilege design lands
# with API-002 migrations; this script only creates the login-capable
# authenticator and the NOLOGIN roles it can switch to.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v auth_pass="$POSTGREST_AUTHENTICATOR_PASSWORD" <<'SQL'
CREATE ROLE anon NOLOGIN NOINHERIT;
CREATE ROLE authenticated NOLOGIN NOINHERIT;
CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD :'auth_pass';
GRANT anon, authenticated TO authenticator;

-- The exposed surface PostgREST loads at startup. API-002 migrations own its
-- contents and the full privilege model; this only lets PostgREST boot.
CREATE SCHEMA IF NOT EXISTS api;
GRANT USAGE ON SCHEMA api TO anon, authenticated;
SQL
