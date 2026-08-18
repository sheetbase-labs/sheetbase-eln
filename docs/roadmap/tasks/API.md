# API — API & Developer Platform

**Status:** API-01 complete (`#40`). API-02 complete (`#47` / `df27039`). **API-07 — Core External Allowlist Cut-over** is complete. API-03 (OpenAPI) is not automatically Ready. Personal tokens, named service-account principals, and credential activity-audit events remain later API work and are not API-07.

## Programme goal

Make Sheetbase programmable through a deliberate public domain API rather than exposing internal PostgreSQL/PostgREST implementation details as the integration contract.

The browser is one client of the domain, not the privileged definition of it.

## API-01 — Public API Contract

**Priority:** low. **Status:** **Complete** (contract published; implementation cut-over queued).

### Goal

Define stable, versioned resources and operations for external clients.

### Accepted PC-00 decisions

- Retire `scientific:*` as the **future** public API scope model.
- Design scopes and contracts around **canonical Core resources and capabilities** (Models, Records, Dataset Schemas, Datasets/Versions, Sheet Definitions/Instances, Notebooks/Templates, files).
- Do not perpetuate the removed scientific-table architecture.
- If real existing clients depend on old scopes, define an explicit **migration/deprecation path**. Do not make those scopes the future contract.
- This epic is **contract / audit / documentation**. Inspect the actual server and `/api/db` / token allowlist implementation.
- If implementation requires consequential server architecture, migrations, RLS, transactions or other Medium-level work, **stop at the contract boundary** and queue that implementation separately.

Pre-release update: Sheetbase has no production users or credentials, so `scientific:*` is **removed** in API-02 rather than deprecated.

### Current state (verified API-01 @ `b306654` / `#40`)

External credentials and `POST /api/token` exist. API-07 maps Core Dataset/Sheet/Notebook RPCs onto canonical scopes (`src/lib/external-token.ts`). Schema-authoring and files stay fail-closed. Canonical contract at `docs/public-api-contract.md`.

The browser session path has no allowlist; do not treat PostgREST exposure as the public contract.

### Deliverables

- [x] public resource/operations contract → `docs/public-api-contract.md`
- [x] Core-domain scope proposal (not `scientific:*`) → contract §8
- [x] compatibility/deprecation plan → contract §9
- [x] corrected external API documentation → `docs/external-api.md`
- [x] fail-closed tests aligned to contract → `src/lib/external-token.test.ts`

Start from the RPCs the product should use, not by opening tables.

### Contract requirements

Versioning; stable identity; pagination; filtering/sorting; bulk operations; structured validation errors; stable error codes; optimistic concurrency; idempotency; retry semantics; lifecycle; version access; permission errors; rate limits; deprecation policy.

Documented in `docs/public-api-contract.md` §§4–7 and §9. OpenAPI/SDK/webhook delivery is API-03–06.

### Exit

A developer can read the intended public contract without treating scientific-table REST as current. Implementation of the Core external allowlist cut-over is **API-07**.

**Evidence:** `docs/public-api-contract.md`, updated `docs/external-api.md`, `src/lib/external-token.test.ts`, audit notes in contract §12.

## API-02 — API Credentials & Service Identity

**Priority:** low. **Status:** **Complete for workspace service credentials** (narrowed honestly; see queued remainder).

### Intended original list vs delivery

The original prompt listed personal tokens, service accounts, workspace binding, capability scopes, expiry, rotation, revocation, last-used metadata, credential audit, request attribution, and safe secret handling.

API-02 ships **one** credential type: an owner-minted, workspace-bound secret used as the external **service identity**. It does not invent a second permission model. Core RPC allowlist cut-over is **API-07**.

| Requirement                      | In API-02?           | Notes                                                                                                                           |
| -------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| Workspace binding                | Yes                  | `workspace_id` on the row and in the JWT                                                                                        |
| Capability scopes                | Yes                  | Canonical API-01 vocabulary only; Core RPCs enforced in **API-07**                                                                    |
| Expiry                           | Yes                  | Optional `expires_at` on the credential; JWT access-token TTL remains 300s                                                      |
| Rotation                         | Yes                  | Copies scopes and expiry exactly; never adds a scope                                                                            |
| Revocation                       | Yes                  | Immediate; use-time check on the bearer token                                                                                   |
| Last-used metadata               | Yes                  | Stamped on exchange; shown in Administration                                                                                    |
| Safe secret handling             | Yes                  | Shown once; salted hash at rest; prefix id; exchange rate-limit                                                                 |
| Request attribution              | Yes (existing)       | JWT `credential_id`; not a new identity table                                                                                   |
| Service identity                 | Yes (this type)      | The credential row **is** the service principal                                                                                 |
| Personal tokens                  | **Queued**           | No user-acting token that impersonates a human session                                                                          |
| Named service-account principals | **Queued**           | No second user-like account besides the credential                                                                              |
| Credential audit log             | **Partial / queued** | Created-by, last-used, revoked/expired in the admin list. Create/rotate/revoke are **not** written to workspace activity events |

**Exit (this epic):** external automation authenticates with a workspace-bound secret instead of a human session or database password.

**Evidence:** `src/lib/api-credentials.ts`, `src/lib/api-credential-admin.ts`, `src/components/workspace-admin/admin-api-credentials.tsx`, `tests/db/api-credentials.test.ts`, `src/lib/api-credential-scopes.test.ts`. External Core RPC access is **API-07**.

### Queued (not API-02, not API-07)

- Personal tokens (user-scoped credentials that act as a human)
- Named service-account principals distinct from credential secrets
- Credential create/rotate/revoke rows in the workspace activity audit stream

## API-07 — Core External Allowlist Cut-over

**Priority:** medium. **Status:** Complete (mapped data-plane writes succeed for service credentials with credential attribution).

### Why Medium

This epic changes the **external security boundary**: which tables and RPCs an `api_client` JWT may reach, which minted scopes actually grant those operations, and whether those operations are the same canonical server paths the product UI already uses. It is not Low documentation or credential-UI work.

### Goal

Cut over `src/lib/external-token.ts` (and `api_client` RLS/grants plus write-actor SQL) so credentials carrying canonical Core-domain scopes can call the Dataset, Sheet Instance, and Notebook operations the product already uses. Mapped writes must succeed for `api_client` JWTs that have `credential_id` and no `sub`. Unknown paths stay fail-closed. Do not invent a second permission model. Do not restore scientific-table REST. Do not expose every `api.*` function merely because it exists. Do not mint a fake `sub` or named service-account user rows.

`schema:*` remains distinct from `datasets:*`. `sheets:write` still does not author Sheet Definitions.

### In scope (mapped)

- Dataset: `query_dataset_rows`, `query_dataset_version_rows`, `validate_dataset_row_batch`, `commit_dataset_row_batch`, `snapshot_dataset`, `archive_dataset`, `restore_dataset`; `datasets` INSERT; `dataset_versions` GET
- Sheet Instance: query/preview RPCs (`sheets:read`); create/update/mutate/materialize/upgrade/write-back validation (`sheets:write`); `sheet_instances` GET
- Notebook: `preview_submission_digest` (`reviews:read`); `instantiate_notebook_template_version` and upgrade apply. **Not mapped:** `submit_record_revision`, `run_revision_checks`, `sign_revision`, amendment writers — human-session-only.
- Search: `search` (`projects:read`), `search_sheet_records` (`models:read`)
- Models: `update_record_custom_fields`, Sheet→Record commit RPCs
- Catalogue GET via `schema:read` / `templates:read`

### Out of scope

- Dataset Schema Version / Sheet Definition / notebook template **authoring** RPCs
- File access (`files:*`)
- Human attestation (`submit_record_revision`, `run_revision_checks`, `sign_revision`, amend)
- OpenAPI (API-03), personal tokens, named service accounts, credential audit events
- Scientific-table REST
- Every `api.*` function

### Exit

An external credential with the appropriate Core-domain scopes can pass the proxy allowlist **and complete** the same governed Dataset/Sheet data-plane operations the UI uses (query, validate/commit row batch, snapshot, sheet local mutate, at least one models write), with attribution on credential columns rather than a user id. Everything else remains denied. `api_client` holds EXECUTE on mapped RPCs. Schema-authoring RPCs stay revoked. Submit, sign, amend and revision checks are off the credential allowlist (human-session-only).

**Evidence:** `src/lib/external-token.ts`, `src/lib/external-token.test.ts`, `drizzle/0114_api_07_core_external_allowlist.sql`, `drizzle/0115_api_07_credential_write_actors.sql`, `drizzle/0116_api_07_revoke_human_attestation.sql`, `tests/db/external-api.test.ts`, `docs/public-api-contract.md` §2.1 and §8.2.

## API-03 — OpenAPI & Documentation

Authoritative OpenAPI, versioned docs, examples, error reference, pagination/filter guidance, idempotency/retry guidance, authentication and deprecation notes.

**Exit:** a developer can integrate without reading application source.

## API-04 — Python SDK

Typed resources, authentication, pagination iterators, pandas conversion, bulk upload/download, idempotent mutation helpers, stable exceptions, version compatibility and optional async where useful.

**Exit:** scientific Python users can treat Sheetbase as a data platform without hand-writing HTTP.

## API-05 — TypeScript SDK

Typed domain resources, auth, pagination, errors, idempotency, concurrency and browser/server-safe client boundaries.

**Exit:** application/integration developers consume the public contract through maintained types rather than internal app code.

## API-06 — Webhooks & Event Delivery

Subscriptions; signed payloads; stable event schema; retries/backoff; delivery history; replay; idempotency; endpoint disablement; events such as Record created, Dataset updated/versioned and Notebook submitted.

**Exit:** external systems can react reliably without polling.

## Boundaries

- Do not expose every SQL table merely because PostgREST can.
- Do not create an API-specific permission model.
- Do not make SDKs depend on browser-only routes.
- Do not promise backwards compatibility before an explicit version/deprecation policy exists.
- Do not restore scientific-table write paths in order to honour stale documentation.
- Pre-release: when a development-era contract is superseded, remove it rather than keeping a compatibility shim unless a concrete current dependency requires it.
