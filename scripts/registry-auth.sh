#!/usr/bin/env bash
#
# Materialise a GitHub Packages credential into the user-level ~/.npmrc so pnpm
# can install the private @sheetbase-labs packages.
#
# Why a script: pnpm deliberately ignores credentials in a *project* .npmrc —
# a committed file must not be able to exfiltrate a secret to a registry
# someone else controls — so the token has to arrive from a trusted location.
#
#   GITHUB_PACKAGES_TOKEN=… scripts/registry-auth.sh
#
# The token may also come from NODE_AUTH_TOKEN or GH_TOKEN. With none of them
# set, it falls back to `gh auth token` when the GitHub CLI is authenticated.
# The value is never printed, and an existing entry is replaced rather than
# duplicated, so the script is safe to run repeatedly.
set -euo pipefail

key='//npm.pkg.github.com/:_authToken'

token="${GITHUB_PACKAGES_TOKEN:-${NODE_AUTH_TOKEN:-${GH_TOKEN:-}}}"
if [ -n "$token" ]; then
  source_desc='environment'
elif command -v gh >/dev/null 2>&1 && gh auth token >/dev/null 2>&1; then
  token="$(gh auth token)"
  source_desc='gh auth token'
else
  printf 'registry-auth: no token. Set GITHUB_PACKAGES_TOKEN (or NODE_AUTH_TOKEN/GH_TOKEN)\n' >&2
  printf 'registry-auth: to a GitHub token with read:packages, then re-run.\n' >&2
  exit 1
fi

npmrc="${HOME}/.npmrc"
touch "$npmrc"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

# Drop any previous entry, then append the current one; keep the file 0600.
grep -v -- "^${key}=" "$npmrc" > "$tmp" || true
printf '%s=%s\n' "$key" "$token" >> "$tmp"
chmod 600 "$tmp"
mv "$tmp" "$npmrc"
trap - EXIT

printf 'registry-auth: wrote %s to %s (source: %s)\n' "$key" "$npmrc" "$source_desc"
