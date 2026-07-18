#!/usr/bin/env bash
# API-005 CLI example: exchange a scoped credential for a short-lived
# PostgREST token, then read the projects visible to that credential's
# workspace through the same-origin /api/db boundary.
#
# Usage against a local dev server (pnpm dev):
#   scripts/read-project.sh <credential-string>
#
# The script talks to the app's /api/token and /api/db endpoints, not to
# PostgREST directly — exactly what an external integration does.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "Usage: $0 <credential-string>" >&2
  echo "Example: $0 sb_1a2b3c4d_..." >&2
  exit 64
fi

CREDENTIAL="$1"
BASE_URL="${BASE_URL:-http://localhost:3000}"

# Exchange the credential for a short-lived token. Request only projects:read.
TOKEN_RESPONSE=$(curl -fsS -X POST "${BASE_URL}/api/token" \
  -H 'content-type: application/json' \
  -d "{\"credential\":\"${CREDENTIAL}\",\"scopes\":[\"projects:read\"]}")

TOKEN=$(printf '%s' "${TOKEN_RESPONSE}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["token"])')

# Use the token to read projects through the same-origin data boundary.
# The app's /api/db proxy forwards to PostgREST with the token as a Bearer
# header; RLS scopes the response to the credential's workspace.
curl -fsS "${BASE_URL}/api/db/projects?select=key,title&order=created_at.desc" \
  -H "authorization: Bearer ${TOKEN}"
echo
