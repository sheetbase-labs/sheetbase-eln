#!/usr/bin/env bash
# .cursor/start.sh — per-boot reconciliation. Runs every time the environment
# starts (including a fresh boot from a build snapshot). Brings up the backing
# services the app needs — PostgreSQL and PostgREST — then returns. It is
# idempotent and must not install packages or seed data.
#
# The Vite dev server runs as a named terminal (see .cursor/environment.json)
# so its logs stay visible and it can be restarted independently.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Ensuring PostgreSQL 18 cluster is online"
if command -v pg_lsclusters >/dev/null 2>&1; then
  if ! pg_lsclusters --no-header 2>/dev/null | awk '$1=="18"&&$2=="main"&&$4=="online"{f=1}END{exit !f}'; then
    sudo pg_ctlcluster 18 main start
  fi
fi
for _ in $(seq 1 30); do
  if sudo -u postgres pg_isready -q; then break; fi
  sleep 1
done
sudo -u postgres pg_isready

echo "==> Ensuring PostgREST is running"
# PostgREST admin readiness endpoint (from .env.local, default 3002).
ADMIN_PORT="$(grep -E '^POSTGREST_ADMIN_PORT=' .env.local 2>/dev/null | cut -d= -f2)"
ADMIN_PORT="${ADMIN_PORT:-3002}"
if ! curl -sf "http://127.0.0.1:${ADMIN_PORT}/ready" >/dev/null 2>&1; then
  # Launch detached so it survives this script returning. scripts/postgrest.sh
  # loads .env.local and points PGRST_DB_URI at localhost.
  setsid bash ./scripts/postgrest.sh >/tmp/postgrest.log 2>&1 < /dev/null &
  for _ in $(seq 1 30); do
    if curl -sf "http://127.0.0.1:${ADMIN_PORT}/ready" >/dev/null 2>&1; then break; fi
    sleep 1
  done
fi
if curl -sf "http://127.0.0.1:${ADMIN_PORT}/ready" >/dev/null 2>&1; then
  echo "postgrest: ready on admin port ${ADMIN_PORT}"
else
  echo "postgrest: NOT ready (see /tmp/postgrest.log)" >&2
fi

echo "==> start.sh complete."
