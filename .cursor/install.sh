#!/usr/bin/env bash
# .cursor/install.sh — durable, idempotent setup for the Cloud Agent
# environment. Runs once after checkout (and again on re-runs / build creation).
# Installs system dependencies, prepares PostgreSQL 18 + PostgREST, installs
# project dependencies, migrates the database and seeds demo data.
#
# Per-boot service startup lives in .cursor/start.sh, not here: a build snapshot
# captures files and the database data directory, but not running processes.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Ensuring Node.js >=22.12"
# Cloud base images ship a recent Node; only intervene if it is too old.
if ! node -v 2>/dev/null | grep -qE '^v(2[2-9]|[3-9])\.'; then
  if ! command -v n >/dev/null 2>&1; then
    sudo npm install -g n
  fi
  sudo n 22
fi
echo "node: $(node -v)"

echo "==> Ensuring pnpm@11.9.0 via corepack"
# The base image may already ship the pinned pnpm (e.g. via nvm's corepack
# shims). Only (re)activate when the version does not match. Try a userspace
# `corepack enable` first and fall back to sudo; tolerate either being absent.
if ! pnpm -v 2>/dev/null | grep -qx '11.9.0'; then
  corepack enable >/dev/null 2>&1 || sudo corepack enable >/dev/null 2>&1 || true
  corepack prepare pnpm@11.9.0 --activate
fi
echo "pnpm: $(pnpm -v)"

echo "==> Ensuring PostgreSQL 18 is installed (PGDG)"
# Cloud base images do not ship PostgreSQL 18. Install it from the PostgreSQL
# APT repository when the versioned cluster tooling or package is unavailable.
if ! command -v pg_ctlcluster >/dev/null 2>&1 || ! apt-cache show postgresql-18 >/dev/null 2>&1; then
  echo "==> Installing PostgreSQL 18 from PGDG"
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends ca-certificates curl gnupg
  sudo install -d -m 0755 /usr/share/keyrings
  curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
    | gpg --dearmor \
    | sudo tee /usr/share/keyrings/postgresql-pgdg.gpg >/dev/null
  echo "deb [signed-by=/usr/share/keyrings/postgresql-pgdg.gpg] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release && echo "$VERSION_CODENAME")-pgdg main" \
    | sudo tee /etc/apt/sources.list.d/pgdg.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y --no-install-recommends postgresql-18 postgresql-client-18
fi

echo "==> Starting PostgreSQL 18"
PG_CONF=/etc/postgresql/18/main/postgresql.conf
# Tune for speed over durability: this is an ephemeral dev/test environment.
sudo sed -i 's/^#\?\s*fsync\s*=.*/fsync = off/' "$PG_CONF"
sudo sed -i 's/^#\?\s*synchronous_commit\s*=.*/synchronous_commit = off/' "$PG_CONF"
# The base image lacks the snakeoil SSL certs the Debian config expects; disable
# SSL for the local-only dev/test cluster.
sudo sed -i 's/^#\?\s*ssl\s*=.*/ssl = off/' "$PG_CONF"
if ! pg_lsclusters --no-header 2>/dev/null | awk '$1=="18"&&$2=="main"&&$4=="online"{f=1}END{exit !f}'; then
  sudo pg_ctlcluster 18 main start
fi
# Wait for it to accept connections.
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then break; fi
  sleep 1
done
sudo -u postgres pg_isready

echo "==> Preparing .env.local"
[ -f .env.local ] || cp -- .env.example .env.local
set -a
# shellcheck disable=SC1091
. ./.env.local
set +a

echo "==> Creating database roles and database (idempotent)"
# Mirrors docker/db/init/00-roles.sh but safe to rerun. Passwords come from
# .env.local. Grants and per-object privileges live in migrations.
sudo -u postgres psql -v ON_ERROR_STOP=1 \
  -v auth_pass="$POSTGREST_AUTHENTICATOR_PASSWORD" \
  -v migrator_pass="$MIGRATOR_PASSWORD" \
  -v formula_pass="$FORMULA_WRITER_PASSWORD" \
  -v sandbox_pass="$PIPELINE_SANDBOX_PASSWORD" \
  -v db_name="$POSTGRES_DB" \
  -v app_user="$POSTGRES_USER" \
  -v app_pass="$POSTGRES_PASSWORD" <<'SQL'
-- Application/superuser role the compose image creates from POSTGRES_USER.
-- The app and test helpers connect with it via DATABASE_URL; in compose it is
-- a superuser, so mirror that for the local cluster.
SELECT format('CREATE ROLE %I LOGIN SUPERUSER PASSWORD %L', :'app_user', :'app_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_user')\gexec
ALTER ROLE :"app_user" WITH LOGIN SUPERUSER PASSWORD :'app_pass';

-- PostgREST request roles (switched to by authenticator per request).
SELECT 'CREATE ROLE anon NOLOGIN NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon')\gexec
SELECT 'CREATE ROLE authenticated NOLOGIN NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated')\gexec
SELECT 'CREATE ROLE api_client NOLOGIN NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='api_client')\gexec

-- PostgREST connection role: the only credential PostgREST holds.
SELECT format('CREATE ROLE authenticator LOGIN NOINHERIT PASSWORD %L', :'auth_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticator')\gexec
GRANT anon, authenticated, api_client TO authenticator;

-- Migration role: owns schemas and tables so DDL never runs as superuser.
SELECT format('CREATE ROLE migrator LOGIN NOINHERIT PASSWORD %L', :'migrator_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='migrator')\gexec

-- Narrowly controlled service operations (AUTH-003 token exchange, workers).
SELECT 'CREATE ROLE service_role NOLOGIN NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='service_role')\gexec

-- Keep passwords in sync with .env.local on reruns.
ALTER ROLE authenticator PASSWORD :'auth_pass';
ALTER ROLE migrator PASSWORD :'migrator_pass';

-- Trusted formula persistence capability (CALC-002). Migrations grant this
-- role scoped access to internal schemas; it must exist before 0017 runs.
SELECT 'CREATE ROLE formula_writer NOLOGIN NOINHERIT'
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='formula_writer')\gexec
GRANT formula_writer TO migrator WITH ADMIN OPTION;
SELECT format('CREATE ROLE formula_runtime LOGIN NOINHERIT PASSWORD %L', :'formula_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='formula_runtime')\gexec
GRANT formula_writer TO formula_runtime;
ALTER ROLE formula_runtime PASSWORD :'formula_pass';

-- Pipeline SQL sandbox login: zero grants, no role memberships (see
-- docker/db/init/00-roles.sh).
SELECT format('CREATE ROLE pipeline_sandbox LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 32 PASSWORD %L', :'sandbox_pass')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='pipeline_sandbox')\gexec
ALTER ROLE pipeline_sandbox PASSWORD :'sandbox_pass';
ALTER ROLE pipeline_sandbox SET temp_file_limit = '1GB';
ALTER ROLE pipeline_sandbox SET statement_timeout = '90s';
ALTER ROLE pipeline_sandbox SET idle_session_timeout = '10min';
ALTER ROLE pipeline_sandbox SET search_path = pg_temp;

-- migrator owns the database, matching 00-roles.sh.
SELECT format('CREATE DATABASE %I OWNER migrator', :'db_name')
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = :'db_name')\gexec
ALTER DATABASE :"db_name" OWNER TO migrator;

-- The exposed surface PostgREST loads at startup. Migrations own its contents;
-- this only lets PostgREST boot before the first migration.
CREATE SCHEMA IF NOT EXISTS api AUTHORIZATION migrator;
GRANT USAGE ON SCHEMA api TO anon, authenticated, api_client;
SQL

echo "==> Installing dependencies (frozen lockfile)"
pnpm install --frozen-lockfile

echo "==> Verifying TanStack Router route tree"
# routeTree.gen.ts is committed. Only regenerate it if it is missing (e.g. a
# fresh checkout without the generated file). Running `tsr generate`
# unconditionally would mutate a clean checkout.
if [ ! -f src/routeTree.gen.ts ]; then
  echo "    src/routeTree.gen.ts not found — regenerating"
  pnpm generate-routes
else
  echo "    src/routeTree.gen.ts present — using committed version"
fi

echo "==> Applying database migrations"
pnpm db:migrate

echo "==> Installing PostgREST v14.5 static binary"
# Use the exact v14.5 release that compose.yaml and the orb docs specify — not
# v16, which has breaking config changes.
if ! command -v postgrest >/dev/null 2>&1; then
  curl -fL -o /tmp/postgrest.tar.xz \
    https://github.com/PostgREST/postgrest/releases/download/v14.5/postgrest-v14.5-linux-static-x86-64.tar.xz
  tar -xJf /tmp/postgrest.tar.xz -C /tmp
  sudo install -m 0755 /tmp/postgrest /usr/local/bin/postgrest
  rm -f /tmp/postgrest /tmp/postgrest.tar.xz
fi
echo "postgrest: $(postgrest --version)"

echo "==> Enabling auth-free development mode"
# SHEETBASE_DEV_AUTH_FREE creates a fixture session so the app is browsable
# without GitHub OAuth. deployment-config.ts refuses to load it outside
# SHEETBASE_ENV=development.
if grep -q '^SHEETBASE_DEV_AUTH_FREE=' .env.local; then
  sed -i 's/^SHEETBASE_DEV_AUTH_FREE=.*/SHEETBASE_DEV_AUTH_FREE=true/' .env.local
else
  echo "SHEETBASE_DEV_AUTH_FREE=true" >> .env.local
fi

echo "==> Pointing PGRST_DB_URI at localhost (non-Docker)"
# .env.example ships with the Docker hostname `postgres`; this VM uses localhost.
sed -i 's|@postgres:5432/|@localhost:5432/|g' .env.local

echo "==> Seeding demo data"
# The demo seed is idempotent and provides the sample/reagent/experiment
# fixtures the UI needs to look populated.
pnpm db:seed:demo || true

echo "==> Install complete."
echo "node $(node -v) | pnpm $(pnpm -v) | postgres $(sudo -u postgres psql -tAc 'show server_version') | postgrest $(postgrest --version)"
