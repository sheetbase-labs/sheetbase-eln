#!/usr/bin/env bash
#
# PLAT-03 / PLAT-01 — local release runner (no GitHub Actions required).
#
# The canonical release path for a deployment whose GitHub account cannot
# run Actions jobs: everything happens on the VPS from a clean checkout,
# producing the same immutable, digest-pinned artifact the CI workflow would,
# and driving the same deploy controller (scripts/deploy.ts).
#
#   1. fetch + detached checkout of the exact release commit
#   2. enforced release gate: typecheck, lint, unit tests, database tests
#      (against a disposable PostgreSQL container), production build, and
#      the production dependency audit — any failure aborts the release
#   3. resolve the Node base image to an immutable @sha256 digest
#   4. build the app and PostgREST images locally (no registry)
#   5. deploy:plan + deploy:apply against the existing controller, which
#      requires a fresh database + objects backup before migrations, waits on readiness, and verifies the exact artifact
#      version, digest and migration before accepting the rollout
#
# Usage (on the VPS, from /opt/sheetbase):
#
#   RELEASE_SHA=<commit> SHEETBASE_ENV=production \
#     set -a; . ./.env.production; set +a; \
#     pnpm release:local
#
# The OCI labels carry the release version (= commit SHA), source revision
# and expected migration, so the readiness proof is identical to a CI-built
# artifact. GitHub Actions workflows (deploy.yml / security.yml) remain the
# path of choice when the account can run them; this script makes the release
# independent of that availability.
set -euo pipefail

RELEASE_SHA="${RELEASE_SHA:?RELEASE_SHA is required (full git commit SHA)}"
if ! [[ "$RELEASE_SHA" =~ ^[0-9a-f]{40}$ ]]; then
  echo "RELEASE_SHA must be a full 40-hex commit SHA" >&2
  exit 1
fi

log() { printf '[release] %s\n' "$*"; }
fail() { printf '[release] ERROR: %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || fail "docker is required on the release host"
command -v git >/dev/null || fail "git is required on the release host"

# The application and PostgREST images are built and consumed entirely on
# this host; names are local-only and never leave the engine.
LOCAL_APP_TAG="sheetbase-local/app:${RELEASE_SHA}"
LOCAL_POSTGREST_TAG="sheetbase-local/postgrest:v14.5"

# ---------------------------------------------------------------------------
# 1. Clean checkout of the exact release commit.
# ---------------------------------------------------------------------------
log "fetching origin and checking out ${RELEASE_SHA}"
git fetch origin main
git checkout --detach "$RELEASE_SHA"
if [ -n "$(git status --porcelain --untracked-files=all)" ]; then
  fail "worktree is not clean after checkout; refusing to build"
fi

log "installing dependencies"
corepack enable >/dev/null 2>&1 || true
corepack prepare pnpm@11.9.0 --activate >/dev/null 2>&1 || true
pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# 2. Enforced release gate.
# ---------------------------------------------------------------------------
log "release gate: typecheck"
pnpm typecheck
log "release gate: lint"
pnpm lint
log "release gate: unit tests"
pnpm test
log "release gate: production dependency audit"
pnpm audit --prod --audit-level=high

# Database tests need the role skeleton (docker/db/init/00-roles.sh) and a
# disposable database; run them against a throwaway PostgreSQL container so
# the production database is never touched.
log "release gate: database tests (disposable PostgreSQL container)"
DBGATE_CONTAINER="sheetbase-release-gate-postgres"
docker rm -f "$DBGATE_CONTAINER" >/dev/null 2>&1 || true
docker run -d --rm --name "$DBGATE_CONTAINER" \
  -e POSTGRES_DB=sheetbase \
  -e POSTGRES_USER=sheetbase \
  -e POSTGRES_PASSWORD=release-gate \
  -p 127.0.0.1:5432:5432 \
  postgres:18-alpine >/dev/null
trap 'docker rm -f '"$DBGATE_CONTAINER"' >/dev/null 2>&1 || true' EXIT
for _ in $(seq 1 30); do
  if docker exec "$DBGATE_CONTAINER" pg_isready -U sheetbase -d sheetbase >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
docker exec -i -e PIPELINE_SANDBOX_PASSWORD=release-gate \
  -e POSTGRES_USER=sheetbase \
  -e POSTGRES_DB=sheetbase \
  -e POSTGREST_AUTHENTICATOR_PASSWORD=release-gate \
  -e MIGRATOR_PASSWORD=release-gate \
  -e FORMULA_WRITER_PASSWORD=release-gate \
  "$DBGATE_CONTAINER" sh < docker/db/init/00-roles.sh
docker exec "$DBGATE_CONTAINER" psql -U sheetbase -d sheetbase \
  -c 'ALTER USER sheetbase CREATEDB'
# Gate-only environment, scoped to the test:db process so it can never leak
# into deploy:apply (which must use the production credentials).
env \
  DATABASE_URL="postgresql://sheetbase:release-gate@127.0.0.1:5432/sheetbase" \
  MIGRATION_DATABASE_URL="postgresql://sheetbase:release-gate@127.0.0.1:5432/sheetbase" \
  FORMULA_DATABASE_URL="postgresql://sheetbase:release-gate@127.0.0.1:5432/sheetbase" \
  PGRST_DB_URI="postgresql://authenticator:release-gate@127.0.0.1:5432/sheetbase" \
  POSTGREST_URL="http://127.0.0.1:3001" \
  POSTGREST_ADMIN_URL="http://127.0.0.1:3002" \
  BETTER_AUTH_SECRET="${BETTER_AUTH_SECRET:-release-gate-placeholder-32-chars-min}" \
  PGRST_JWT_SECRET="${PGRST_JWT_SECRET:-release-gate-placeholder-32-chars-min}" \
  pnpm test:db

log "release gate: production build"
pnpm build

# ---------------------------------------------------------------------------
# 3-4. Immutable artifacts, built locally.
# ---------------------------------------------------------------------------
log "resolving Node base image digest"
docker pull node:22-alpine >/dev/null
NODE_IMAGE="$(docker inspect --format '{{index .RepoDigests 0}}' node:22-alpine)"
if ! [[ "$NODE_IMAGE" =~ @sha256:[a-f0-9]{64}$ ]]; then
  fail "could not resolve an immutable Node base image digest"
fi

log "building PostgREST image locally"
docker build \
  --build-arg POSTGREST_VERSION=v14.5 \
  --tag "$LOCAL_POSTGREST_TAG" \
  docker/postgrest >/dev/null

log "building immutable application artifact for ${RELEASE_SHA}"
ARTIFACT_JSON="$(
  SHEETBASE_NODE_IMAGE="$NODE_IMAGE" \
  SHEETBASE_ARTIFACT_VERSION="$RELEASE_SHA" \
  SHEETBASE_ARTIFACT_TAG="$LOCAL_APP_TAG" \
  pnpm artifact:build
)"
IMAGE_ID="$(printf '%s\n' "$ARTIFACT_JSON" | sed -n 's/.*"imageId": "\(sha256:[a-f0-9]\{64\}\)".*/\1/p' | head -n 1)"
if [ -z "$IMAGE_ID" ]; then
  fail "artifact build did not report an image id"
fi
POSTGREST_IMAGE_ID="$(docker image inspect --format '{{.Id}}' "$LOCAL_POSTGREST_TAG")"

SHEETBASE_APP_IMAGE="$LOCAL_APP_TAG@$IMAGE_ID"
SHEETBASE_POSTGREST_IMAGE="$LOCAL_POSTGREST_TAG@$POSTGREST_IMAGE_ID"
export SHEETBASE_APP_IMAGE SHEETBASE_POSTGREST_IMAGE
log "app image:      $SHEETBASE_APP_IMAGE"
log "postgrest image: $SHEETBASE_POSTGREST_IMAGE"

# ---------------------------------------------------------------------------
# 5. Plan and apply through the existing controller.
# ---------------------------------------------------------------------------
log "deploy plan"
pnpm deploy:plan
log "deploy apply (required backup -> migrate -> app -> readiness)"
pnpm deploy:apply

log "release ${RELEASE_SHA} complete — verify https://app.sheetbase.co.uk/api/health/ready"
