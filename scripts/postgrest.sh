#!/usr/bin/env bash
# Start PostgREST for local orb development (Postgres on localhost, not the
# compose hostname). Mirrors compose.yaml but overrides PGRST_DB_URI.
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
. ./.env.local
set +a
export PGRST_DB_URI="postgresql://authenticator:${POSTGREST_AUTHENTICATOR_PASSWORD}@localhost:5432/${POSTGRES_DB}"
export PGRST_DB_SCHEMAS="api"
export PGRST_DB_ANON_ROLE="anon"
export PGRST_JWT_SECRET
export PGRST_SERVER_PORT="${POSTGREST_PORT:-3001}"
export PGRST_ADMIN_SERVER_PORT="${POSTGREST_ADMIN_PORT:-3002}"
exec postgrest
