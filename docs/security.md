# Security posture (PLAT-03)

This document is the PLAT-03 inventory of Sheetbase's security surfaces. For
each surface it lists the trust boundary, the authoritative permission check,
the abuse risk, the current control, and any accepted gap. The controls
described here are deliberate and tested (see §3 for the executable
evidence), not accidental.

Pre-release context: Sheetbase has **no production users or production
data**. Superseded or unsafe development-era paths are removed, not shimmed.
Enterprise-grade controls (WAF, formal penetration testing) are explicitly
deferred until usage justifies them — see §5.

## 1. Surface inventory

| Surface                                              | Trust boundary                        | Caller                                                | Authoritative check                                                                                               | Abuse risk                                  | Control                                                                                                                                                                                        | Gap                                                                                                      |
| ---------------------------------------------------- | ------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Authentication (GitHub OAuth)                        | anonymous → identified                | browser                                               | Better Auth + GitHub OAuth; provider is the identity proof                                                        | credential phishing, callback forgery       | `state` cookie `SameSite=None; Secure` (justified: cross-site top-level redirect); fail-closed when OAuth unconfigured                                                                         | none accepted                                                                                            |
| Sessions                                             | identified → workspace actor          | browser cookies                                       | Better Auth DB sessions; `httpOnly`, `Secure` cookies                                                             | session theft, fixation                     | httpOnly + Secure + DB-backed revocable sessions; `BETTER_AUTH_SECRET` rotation documented in deployment.md                                                                                    | none accepted                                                                                            |
| Dev auth-free mode                                   | development only                      | seeded identity                                       | `SHEETBASE_DEV_AUTH_FREE` rejected by `validateDeploymentConfig` for staging/production                           | accidental auth-free deployment             | fail-fast at server startup                                                                                                                                                                    | none accepted                                                                                            |
| Workspace membership / roles                         | workspace-scoped data                 | authenticated users                                   | `api.workspace_memberships` via RLS predicates + `is_workspace_member`/`is_workspace_writer`                      | cross-workspace data access                 | PostgreSQL RLS on every api table (see §2)                                                                                                                                                     | none accepted                                                                                            |
| Capability resolution                                | privileged operations                 | session actors                                        | `api.has_capability` (role mapping); `api_client` gets only data-plane capabilities                               | self-granting capabilities                  | H1: `sheetbase.capability_mask` honoured only for the trusted `migrator` login; **api_client + mask ⇒ 42501 fail-closed** (migration 0139); masked-by-test suite removed from the release gate | none accepted                                                                                            |
| Service credentials / personal tokens                | external systems, scripts             | `Authorization: Bearer`                               | `api_client` JWT minted from hashed secret; revocation checked at use time; scope allowlist enforced in the proxy | credential leak, scope escalation           | secrets stored hashed; JWT TTL ≤ 300 s; fail-closed unknown-path allowlist; rotation runbook in deployment.md                                                                                  | none accepted                                                                                            |
| Public API (`/api/token`, `/api/db` bearer path)     | internet                              | external credentials                                  | per-credential exchange rate limit + scope check per request                                                      | brute force, abuse                          | credential exchange rate-limited since #43; scoped JWTs; `api_client` RLS isolation                                                                                                            | none accepted                                                                                            |
| PostgREST proxy (`/api/db/*`)                        | browser/external → internal PostgREST | session or credential                                 | session→JWT mint or token verification; path allowlist; query validation; capability-checked RPCs                 | IDOR, injection, abuse volume               | RLS + scope checks upstream; **PLAT-03: fixed-window rate limit per principal (default 600/min, fail-open, 429 `rate_limited`)**                                                               | in-memory limiter is per-instance (single-container topology; move behind the interface if that changes) |
| File uploads/downloads                               | bytes bypass the JSON boundary        | session actors                                        | metadata via PostgREST RLS RPCs; storage key server-generated; per-request byte cap; checksum pinning             | malware upload, bytes theft, path traversal | upload authorize/finalize flow; oversize abort; **PLAT-03: request-rate bound on byte routes**                                                                                                 | content scanning (AV) deliberately deferred — no third-party mail/preview surface yet                    |
| Connectors (INT)                                     | external systems in                   | workspace writers                                     | `integrations.manage` capability + connector status; sealed secrets; bounded egress policy                        | SSRF, secret leakage                        | host policy (`host-policy.server.ts`: http(s) only, credential-bearing URLs and `file://` refused, private-host allowlist); sealed secret storage                                              | connector egress allowlist defaults documented as app policy, not network isolation                      |
| Metrics endpoint (`/api/metrics`)                    | operational data                      | scraper                                               | bearer token in staging/production; 404 fail-closed without one                                                   | operational data exposure                   | token ≥ 32 chars, constant-time compare; loopback-only binding in deployment                                                                                                                   | none accepted                                                                                            |
| Health endpoints (`/api/health/*`)                   | public probes                         | anyone                                                | none required (liveness); bounded dependency checks                                                               | trivial DoS                                 | cheap probes, bounded timeouts, no secret material in bodies                                                                                                                                   | none accepted                                                                                            |
| Admin/steward operations                             | governance surfaces                   | stewards+                                             | `workspace.admin` / `schema.*` capabilities server-side                                                           | privilege abuse                             | capability checks in SECURITY DEFINER RPCs; `viewer` read-only (GOV-01)                                                                                                                        | none accepted                                                                                            |
| SECURITY DEFINER RPCs                                | privileged DB execution               | role `authenticated` (+ explicit `api_client` grants) | capability checks inside each function                                                                            | privilege escalation                        | 203 functions, all `SET search_path = ''`; explicit ACLs (no default PUBLIC EXECUTE); invariant-tested (§3)                                                                                    | none accepted                                                                                            |
| RLS                                                  | workspace isolation                   | all request roles                                     | policies per table keyed on `current_workspace_id()` + membership                                                 | cross-workspace read/write                  | RLS enabled on 100/101 api tables; the exception (`workspace_change_seq`) carries no workspace data and is migrator-only; **invariant-tested**                                                 | FORCE RLS not set — table owner is the trusted migrator; acceptable while DDL is migrator-only           |
| Secret storage                                       | credentials at rest                   | operators                                             | secret manager injection (deployment) / hashed columns (DB)                                                       | secret leakage                              | redaction in logs; secrets never in image labels or CLI args; masked keys in `logger.ts`                                                                                                       | none accepted                                                                                            |
| Deployment secrets                                   | VPS host                              | deploy controller                                     | `.env.production` (0600 operator practice), never committed                                                       | secret exposure                             | documented in deployment.md + recovery.md                                                                                                                                                      | none accepted                                                                                            |
| Backups                                              | full data copies                      | operators/cron                                        | OS file mode                                                                                                      | backup theft                                | **PLAT-03: backup dir 0700, dump/archive/manifest 0600**; encryption-at-rest inherited from the VPS volume; off-host copies are PLAT-03-follow-up when they exist                              | encryption key separation deferred until off-host backups exist                                          |
| External network calls (connectors, OAuth, webhooks) | app → internet                        | server / browser                                      | host policy for connectors; TLS to GitHub/Liveblocks                                                              | SSRF, data exfiltration                     | connector host policy; no generic URL fetch surface                                                                                                                                            | none accepted                                                                                            |

## 2. PostgreSQL posture (audit result)

Audited against the fully-migrated schema (and now continuously asserted in
`tests/db/plat-03-security-audit.test.ts`):

- **RLS:** 100/101 `api` tables have RLS enabled. The exception,
  `workspace_change_seq`, is an allocation counter that holds no workspace
  data. It is granted to `migrator` only.
- **FORCE RLS:** not used. The table owner is `migrator`, a trusted DDL role.
  Application request roles always go through RLS. Revisit this if any
  application role ever owns tables.
- **SECURITY DEFINER:** 203 functions; every one pins `SET search_path = ''`.
- **Grants:** no `PUBLIC` or `anon` table privileges in `api`. Every function
  carries an explicit ACL (a NULL ACL would restore the PostgreSQL default
  PUBLIC EXECUTE). `api_client` holds EXECUTE only on the API-07 allowlisted
  RPCs and workspace-pinned helpers.
- **H1 capability mask:** honoured only for `session_user = 'migrator'`.
  Under the `api_client` role, a mask in the request context now raises
  `42501` (migration 0139) instead of being silently ignored.

## 3. Executable evidence

- `tests/db/plat-03-security-audit.test.ts` — the §2 invariants as tests.
- `tests/db/core-h1-capability-mask.test.ts` — capability mask boundaries,
  including the api_client fail-closed case (previously failing on main,
  fixed by migration 0139; the release-gate exclusion is removed).
- `src/lib/rate-limit.test.ts`, `src/lib/postgrest-proxy.test.ts` —
  fixed-window behaviour, per-principal keying, 429 envelope, metrics.
- `tests/config/plat-03.test.ts` — security workflow present; dependency
  audit gate present; metric/limiter wiring.

## 4. Dependency and static analysis

- **Dependency audit — enforced release gate:** the production tree must be
  free of high+ advisories. `pnpm audit --prod --audit-level=high` is a step
  in the `deploy.yml` verify job (its non-zero exit blocks the release) and
  runs for visibility on `main` in `security.yml`. Current accepted
  exceptions (both **moderate**, both unreachable from untrusted input):
  `esbuild@0.18` (drizzle-kit local tooling; the advisory requires running
  its dev server) and `postcss` (build-time). Re-triaged whenever the audit
  output changes.
- **Pre-merge PR auditing — deferred (explicit).** A PR-triggered audit was
  implemented and then removed. The GitHub account currently cannot start
  any CI job (billing block). GitHub marks a job that cannot start as
  **failed**; the workflow offers no "skipped" outcome. A PR check would
  therefore report red for environmental reasons and add no signal that the
  release gate does not already enforce. The contract is therefore
  **release-time enforcement on `main`**: a vulnerable dependency fails the
  deploy gate before it serves traffic. This is documented, not misclaimed.
  Re-add a PR-triggered audit workflow (identical command) when the account
  can run CI reliably.
- **Overrides:** `js-yaml`, `nanoid` (and `jsdom` upgraded), so the tree is
  free of patched advisories rather than ignoring them.
- **SAST:** CodeQL (`javascript-typescript`, `security-extended` queries) on
  main pushes and a weekly schedule in `security.yml`. Findings are triaged
  on the Security tab. They intentionally do not block a release until the
  initial alert set is baselined. After that, new alerts gate like bugs.

## 5. Deliberately deferred

- **Nonce/hash CSP:** **done** in this pass (see
  `docs/security-headers.md` — per-request nonce; production `script-src`
  no longer uses `'unsafe-inline'`).
- **General nonce/2FA/hardening of Better Auth internals:** reviewed
  (cookies httpOnly + Secure + revocable DB sessions). Deeper session
  hardening waits for real usage patterns.
- **Penetration testing:** appropriate when there are production users and
  an external attack surface worth testing at scale. Before that, the
  boundaries above plus the API/browser test layers are the practical
  programme.
- **Backup encryption key separation:** meaningful only once backups have an
  off-VPS copy. Tracked with that change.
- **WAF / DDoS edge controls:** Cloudflare fronts the origin. Custom rules
  wait for traffic evidence.
