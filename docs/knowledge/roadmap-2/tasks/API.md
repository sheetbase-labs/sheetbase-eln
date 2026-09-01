# API — API & Developer Platform

**Status:** The **API foundation is complete**: API-01 contract (`#40`), API-02 credentials — service credentials, personal tokens, credential lifecycle audit events (`#47`, remainder in `#56`), API-07 external allowlist cut-over, and API-03 OpenAPI for the resulting external credential surface (`#51`, reconciled with both credential kinds in `#56`). Named service-account principals remain **queued and require an ADR** before implementation. Do not start API-04/05/06 as part of this work.

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

External credentials and `POST /api/token` exist. API-07 maps Core Dataset/Sheet/Notebook RPCs onto canonical scopes (`src/lib/external-token.ts`). Schema-authoring and files stay fail-closed. Canonical contract at `docs/api/public-api-contract.md`.

The browser session path has no allowlist; do not treat PostgREST exposure as the public contract.

### Deliverables

- [x] public resource/operations contract → `docs/api/public-api-contract.md`
- [x] Core-domain scope proposal (not `scientific:*`) → contract §8
- [x] compatibility/deprecation plan → contract §9
- [x] corrected external API documentation → `docs/api/external-api.md`
- [x] fail-closed tests aligned to contract → `src/lib/external-token.test.ts`

Start from the RPCs the product should use, not by opening tables.

### Contract requirements

Versioning; stable identity; pagination; filtering/sorting; bulk operations; structured validation errors; stable error codes; optimistic concurrency; idempotency; retry semantics; lifecycle; version access; permission errors; rate limits; deprecation policy.

Documented in `docs/api/public-api-contract.md` §§4–7 and §9. OpenAPI/SDK/webhook delivery is API-03–06.

### Exit

A developer can read the intended public contract without treating scientific-table REST as current. Implementation of the Core external allowlist cut-over is **API-07**.

**Evidence:** `docs/api/public-api-contract.md`, updated `docs/api/external-api.md`, `src/lib/external-token.test.ts`, audit notes in contract §12.

## API-02 — API Credentials & Service Identity

**Priority:** low. **Status:** **Complete** (service credentials + personal tokens + credential audit events).

### Intended original list vs delivery

The original prompt listed personal tokens, service accounts, workspace binding, capability scopes, expiry, rotation, revocation, last-used metadata, credential audit, request attribution, and safe secret handling.

API-02 ships **two** credential types: an owner-minted workspace-bound **service identity** and a member-scoped **personal token** that acts as its creator under the same canonical scopes and fail-closed allowlist. It does not invent a second permission model. Core RPC allowlist cut-over is **API-07**.

| Requirement                      | In API-02? | Notes                                                                                                  |
| -------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------ |
| Workspace binding                | Yes        | `workspace_id` on the row and in the JWT                                                               |
| Capability scopes                | Yes        | Canonical API-01 vocabulary only; Core RPCs enforced in **API-07**                                     |
| Expiry                           | Yes        | Optional `expires_at` on the credential; JWT access-token TTL remains 300s                             |
| Rotation                         | Yes        | Copies scopes and expiry exactly; never adds a scope                                                   |
| Revocation                       | Yes        | Immediate; use-time check on the bearer token                                                          |
| Last-used metadata               | Yes        | Stamped on exchange; shown in Administration                                                           |
| Safe secret handling             | Yes        | Shown once; salted hash at rest; prefix id; exchange rate-limit                                        |
| Request attribution              | Yes        | JWT `credential_id`; not a new identity table                                                          |
| Service identity                 | Yes        | The credential row **is** the service principal                                                        |
| Personal tokens                  | Yes        | User-scoped credentials that act as the creating member under the same allowlist and scopes            |
| Credential audit log             | Yes        | Create/rotate/revoke emit lifecycle events to workspace `change_events` (entity type `api_credential`) |
| Named service-account principals | **Queued** | Requires an ADR; conflicts with current single-principal model until product need exists               |

**Exit (this epic):** external automation authenticates with a workspace-bound secret; personal tokens act as their creating member; credential lifecycle events are visible in the workspace activity stream.

**Evidence:** `src/lib/api-credentials.ts`, `src/lib/credential-audit.ts`, `src/lib/api-credential-admin.ts`, `src/lib/personal-api-tokens.ts`, `src/components/workspace-admin/admin-api-credentials.tsx`, `src/components/settings/settings-api-tokens.tsx`, `src/routes/settings.tsx`, `drizzle/0122_api_02_credential_audit.sql`, `drizzle/0123_api_02_personal_tokens.sql`, `tests/db/api-credentials.test.ts`, `src/lib/api-credential-scopes.test.ts`. External Core RPC access is **API-07**.

### Queued (not API-02, not API-07)

- Named service-account principals distinct from credential secrets (requires ADR)

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
- OpenAPI (API-03) — delivered separately; personal tokens, named service accounts, credential audit events
- Scientific-table REST
- Every `api.*` function

### Exit

An external credential with the appropriate Core-domain scopes can pass the proxy allowlist **and complete** the same governed Dataset/Sheet data-plane operations the UI uses (query, validate/commit row batch, snapshot, sheet local mutate, at least one models write), with attribution on credential columns rather than a user id. Everything else remains denied. `api_client` holds EXECUTE on mapped RPCs. Schema-authoring RPCs stay revoked. Submit, sign, amend and revision checks are off the credential allowlist (human-session-only).

**Evidence:** `src/lib/external-token.ts`, `src/lib/external-token.test.ts`, `drizzle/0114_api_07_core_external_allowlist.sql`, `drizzle/0115_api_07_credential_write_actors.sql`, `drizzle/0116_api_07_revoke_human_attestation.sql`, `tests/db/external-api.test.ts`, `docs/api/public-api-contract.md` §2.1 and §8.2.

## API-03 — OpenAPI & Documentation

**Priority:** medium. **Status:** Complete for the external credential surface that exists today — both workspace service credentials and personal API tokens (`#56`).

### Goal

Publish OpenAPI 3.1 that a developer can use without reading application source, covering only operations an API key can complete.

### Delivered

- `docs/api/openapi/external-api-v0.json` (renamed from `service-credentials-v0.json`; the spec covers the public external API, not one credential kind) generated from `EXTERNAL_TABLE_ACCESS` / `EXTERNAL_RPC_SCOPES`
- Token exchange, pagination/query parameters, error envelopes, idempotency notes on Dataset commit
- `/api/token` documents that it accepts both credential kinds: service credentials exchange into `role=api_client` JWTs (workspace identity, `*_credential_id` attribution); personal tokens exchange into `role=authenticated` JWTs carrying the creating member's real `sub`, constrained by member RLS under the same canonical scopes and fail-closed allowlist, unusable when that membership is removed or suspended, and never implying a browser session (no `session_id`)
- Human-session attestation RPCs (`submit_record_revision`, `run_revision_checks`, `sign_revision`, `create_amendment`) are **absent** from paths
- `reviews:write` is not required by any operation; `reviews:read` maps only to `preview_submission_digest`
- Alignment tests in `src/lib/public-api-openapi.test.ts`

A `/api/v1` URL prefix is not introduced. Paths remain `/api/token` and `/api/db/*`.

### Exit

A developer can integrate the current external credential surface from the OpenAPI file plus `docs/api/openapi/README.md` without reading `src/lib/external-token.ts`.

**Evidence:** `docs/api/openapi/external-api-v0.json`, `src/lib/public-api-openapi.ts`, `src/lib/public-api-openapi.test.ts`.

## API-04 — Python SDK

**Status:** Complete.

Typed resources, authentication, pagination iterators, pandas conversion, bulk upload/download, idempotent mutation helpers, stable exceptions, version compatibility and optional async where useful.

**Delivered:**

- `sdks/python/` — standalone Python package (`sheetbase`, v0.1.0) targeting the external API contract (`docs/api/public-api-contract.md` v0.1.3, OpenAPI `docs/api/openapi/external-api-v0.json`)
- `HttpTransport` / `AsyncHttpTransport` — credential exchange via `POST /api/token`, automatic JWT refresh (300s TTL with 30s buffer), `Authorization: Bearer` header injection, error-envelope parsing (token path `{ error: { code } }` vs data path `{ error: { category, request_id } }`)
- Typed frozen dataclasses with `from_dict()` for `Project`, `Record`, `Dataset`, `DatasetVersion`, `DatasetRow`, `SheetInstance`, `SearchResult`, `CommitResult`, `ValidationResult`, `ValidationFailure`
- Resource classes: `ProjectsResource`, `RecordsResource`, `DatasetsResource`, `SheetsResource`, `SearchResource`, `CataloguesResource` — each wrapping the allowlisted RPCs and table reads from API-07
- Pagination: `iter_table()` (PostgREST `limit`/`offset`) and `iter_rpc()` (`hasMore`/`totalCount`) generators; `.iter()` methods on projects, records, datasets, search
- pandas conversion: `DatasetRowPage.to_dataframe()`, `SearchPage.to_dataframe()`, `DatasetsResource.to_dataframe()` / `download_dataframe()` / `upload_dataframe()` (batched create operations with revision chaining)
- Idempotent mutations: `commit_rows()` with auto-generated `p_idempotency_key`, `DatasetRowBatch` builder, automatic `stale_version` retry (re-reads dataset revision, generates fresh key)
- Stable exception hierarchy: `SheetbaseError` → `TokenError` (`.code`), `DataPathError` (`.category`, `.request_id`) with 13 category-specific subclasses mapping 1:1 to the contract's stable error categories
- `AsyncSheetbaseClient` with proper async resource classes (`AsyncProjects`, `AsyncRecords`, `AsyncDatasets`, `AsyncSheets`, `AsyncSearch`, `AsyncCatalogues`) — all methods are coroutines
- `SheetbaseClient.rpc()` escape hatch for allowlisted RPCs not yet wrapped by a resource
- 68 tests (68 passing) covering token exchange/caching, error mapping, pagination, stale-version retry, idempotency, pandas conversion, async paths

**Exit:** scientific Python users can treat Sheetbase as a data platform without hand-writing HTTP.

**Evidence:** `sdks/python/src/sheetbase/`, `sdks/python/tests/`, `sdks/python/pyproject.toml`, `sdks/python/README.md`. Run `cd sdks/python && python -m pytest -v` (68 passed).

## API-05 — TypeScript SDK

**Status:** Complete.

Typed domain resources, auth, pagination, errors, idempotency, concurrency and browser/server-safe client boundaries.

**Delivered:**

- `sdks/typescript/` — standalone TypeScript package (`@sheetbase/eln-sdk`, v0.1.0) targeting the external API contract (`docs/api/public-api-contract.md` v0.1.3, OpenAPI `docs/api/openapi/external-api-v0.json`)
- `HttpTransport` — credential exchange via `POST /api/token`, automatic JWT refresh (300s TTL with 30s buffer), `Authorization: Bearer` header injection, error-envelope parsing (token path `{ error: { code } }` vs data path `{ error: { category, request_id } }`)
- Isomorphic `fetch` — no runtime dependencies; works in Node 18+ and all modern browsers. Uses the global `fetch` API and Web Crypto `randomUUID()` with fallback
- Typed interfaces with factory functions (`fromProject`, `fromRecord`, `fromDataset`, etc.) for `Project`, `SheetbaseRecord`, `Dataset`, `DatasetVersion`, `DatasetRow`, `SheetInstance`, `SearchResult`, `CommitResult`, `ValidationResult`, `ValidationFailure` — all with snake_case JSON → camelCase TypeScript field mapping
- Resource classes: `ProjectsResource`, `RecordsResource`, `DatasetsResource`, `SheetsResource`, `SearchResource`, `CataloguesResource` — each wrapping the allowlisted RPCs and table reads from API-07
- Pagination: `iterTable()` (PostgREST `limit`/`offset`) and `iterRpc()` (`hasMore`/`totalCount`) async generators; `.iter()` methods on projects, records, datasets, search
- Idempotent mutations: `commitRows()` with auto-generated `p_idempotency_key`, `DatasetRowBatch` builder, automatic `stale_version` retry (re-reads dataset revision, generates fresh key)
- Stable exception hierarchy: `SheetbaseError` → `TokenError` (`.code`), `DataPathError` (`.category`, `.requestId`) with 13 category-specific subclasses mapping 1:1 to the contract's stable error categories
- `SheetbaseClient.rpc()` escape hatch for allowlisted RPCs not yet wrapped by a resource
- 59 tests (59 passing) covering token exchange/caching, error mapping, pagination, stale-version retry, idempotency, batch builder, async iterators

**Exit:** application/integration developers consume the public contract through maintained types rather than internal app code.

**Evidence:** `sdks/typescript/src/`, `sdks/typescript/tests/`, `sdks/typescript/package.json`, `sdks/typescript/README.md`. Run `cd sdks/typescript && npx vitest run` (59 passed) and `npx tsc --noEmit` (clean).

## API-06 — Webhooks & Event Delivery

**Status:** Complete.

Subscriptions; signed payloads; stable event schema; retries/backoff; delivery history; replay; idempotency; endpoint disablement; events such as Record created, Dataset updated/versioned and Notebook submitted.

**Exit:** external systems can react reliably without polling.

### Delivered

- **`api.webhook_subscriptions`** — subscription registry (URL, event type filters, retry config, failure tracking, auto-disablement). RLS: workspace members and `api_client` can read; mutations go through SECURITY DEFINER RPCs only.
- **`api.webhook_deliveries`** — delivery history (one row per delivery attempt). Links to `change_events` via `change_event_id`. Tracks attempt count, HTTP response, error info, next retry time, and delivery status (`pending` → `delivered` / `retrying` / `failed`).
- **`internal.webhook_secrets`** — HMAC-SHA256 signing secrets, PostgREST-invisible (same pattern as `internal.connector_secrets`).
- **Stable event schema** (`src/lib/webhook-events.ts`) — maps internal `change_events` (entity_type + operation) to stable external event types: `record.created`, `record.updated`, `dataset.created`, `dataset.updated`, `dataset.versioned`, `notebook.submitted`, `notebook.signed`, `review.decided`, `sheet_instance.created/updated`, `project.created/updated`, `sheet_definition.versioned`, `notebook_template.versioned`. Schema version `1` with `eventType`, `eventId`, `sequence`, `workspaceId`, `entityUuid`, `payload`, `createdAt`.
- **HMAC-SHA256 payload signing** (`src/lib/webhook-signing.ts`) — `signPayload()` produces `sha256=<hex>` signatures; `verifySignature()` uses timing-safe comparison. Per-subscription signing secrets generated at creation time; rotation via `api.rotate_webhook_secret` RPC.
- **Delivery engine** (`src/lib/webhook-delivery.ts`) — app-server module that LISTENs on `sheetbase_change` (same channel as SSE), finds matching active subscriptions, creates delivery records, and attempts HTTP POST with signed payloads. Exponential backoff with jitter (`computeBackoff()`). Periodic retry processor for scheduled redeliveries. `X-Sheetbase-Signature` header carries the HMAC.
- **Auto-disablement** — `api.record_webhook_delivery_result` RPC increments `consecutive_failures` on failure and auto-disables the subscription when `failure_threshold` is reached. Successful delivery resets the counter. Re-enabling via `update_webhook_subscription(status='active')` also resets.
- **Replay** — `api.replay_webhook_delivery` RPC creates a new pending delivery row from an existing one (new id, attempt 0), so the delivery engine can redeliver.
- **Scopes** — `webhooks:read` and `webhooks:write` added to the canonical scope vocabulary (`src/lib/api-credential-scopes.ts`). `webhooks:write` gates subscription management, rotation, and replay; `webhooks:read` gates delivery history.
- **External allowlist** — webhook tables (`webhook_subscriptions`, `webhook_deliveries`) and RPCs (`create_webhook_subscription`, `update_webhook_subscription`, `delete_webhook_subscription`, `rotate_webhook_secret`, `list_webhook_deliveries`, `replay_webhook_delivery`) mapped in `src/lib/external-token.ts`. Unknown paths stay fail-closed.
- **Capability** — `integrations.manage` (owner/admin/steward) gates subscription management. `api_client` role granted `integrations.manage` in `has_capability` so service credentials can manage webhooks.
- **RPCs**: `create_webhook_subscription`, `update_webhook_subscription`, `delete_webhook_subscription` (soft archive), `rotate_webhook_secret`, `list_webhook_deliveries` (paginated), `replay_webhook_delivery`, `record_webhook_delivery_result` (internal, delivery engine only).
- **Migration**: `drizzle/0147_api_06_webhooks.sql` — tables, RPCs, RLS, capability updates, scopes CHECK constraint update, change_events vocabulary extension.
- **Tests**: 16 DB integration tests (`tests/db/webhooks.test.ts` — subscription CRUD, credential attribution, viewer rejection, auto-disablement, replay, signing secret storage), 15 event mapping unit tests (`src/lib/webhook-events.test.ts`), 11 signing unit tests (`src/lib/webhook-signing.test.ts`), external-token scope mapping test.

**Evidence:** `drizzle/0147_api_06_webhooks.sql`, `src/db/schema.ts` (webhook tables), `src/lib/webhook-events.ts`, `src/lib/webhook-signing.ts`, `src/lib/webhook-delivery.ts`, `src/lib/api-credential-scopes.ts`, `src/lib/external-token.ts`, `tests/db/webhooks.test.ts` (16 passed), `src/lib/webhook-events.test.ts` (15 passed), `src/lib/webhook-signing.test.ts` (11 passed), `src/lib/external-token.test.ts` (28 passed).

## Boundaries

- Do not expose every SQL table merely because PostgREST can.
- Do not create an API-specific permission model.
- Do not make SDKs depend on browser-only routes.
- Do not promise backwards compatibility before an explicit version/deprecation policy exists.
- Do not restore scientific-table write paths in order to honour stale documentation.
- Pre-release: when a development-era contract is superseded, remove it rather than keeping a compatibility shim unless a concrete current dependency requires it.
