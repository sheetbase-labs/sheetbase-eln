# API — API & Developer Platform

**Status:** API-01 complete (`#40`). API-02 complete (`#47`, pending merge). Core allowlist cut-over remains queued.

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

### Current state (verified API-01 @ `b306654` / `#40`)

External credentials and `POST /api/token` exist. The allowlist is **project-domain only** (`src/lib/external-token.ts`). Core Dataset/Sheet/Notebook RPCs fail closed. `scientific:*` scopes are mintable but map to an empty resource set. `docs/external-api.md` corrected; canonical contract at `docs/public-api-contract.md`.

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

A developer can read the intended public contract without treating scientific-table REST as current. Implementation of a new allowlist/scope cut-over is queued (later epic, not API-02).

**Evidence:** `docs/public-api-contract.md`, updated `docs/external-api.md`, `src/lib/external-token.test.ts` (Core RPC deny-list), audit notes in contract §12.

## API-02 — API Credentials & Service Identity

**Priority:** low. **Status:** **Complete** (credentials productised; Core allowlist still fail-closed).

Personal tokens; service accounts; workspace binding; capability scopes; expiry; rotation; revocation; last-used metadata; credential audit; request attribution; safe secret handling.

### Delivered

- [x] Owner-gated Administration → API credentials UI (create, list, rotate, revoke; last-used; created-by)
- [x] Secret shown once; hash-at-rest; prefix identification
- [x] Product scopes from API-01 contract; `scientific:*` rejected on new issuance
- [x] Rotation drops vestigial scientific scopes
- [x] Existing `scientific:*` rows still exchange
- [x] Docs: `docs/external-api.md`, contract §9.2 / §10

**Exit:** external automation authenticates safely without borrowing human sessions or database credentials.

**Evidence:** `src/lib/api-credentials.ts`, `src/lib/api-credential-admin.ts`, `src/components/workspace-admin/admin-api-credentials.tsx`, `tests/db/api-credentials.test.ts` (17 passed), `src/lib/api-credential-scopes.test.ts`, `src/components/workspace-admin/admin-api-credentials.test.tsx`. Allowlist cut-over remains `src/lib/external-token.ts`.

**Queued (not this epic):** Core Dataset/Sheet/Notebook `requiredScopes()` cut-over; JWT expiry UI; reject `scientific:*` at exchange (API-03+).

## API-03 — OpenAPI & Documentation

Authoritative OpenAPI, versioned docs, examples, error reference, pagination/filter guidance, idempotency/retry guidance, authentication and deprecation notes.

**Exit:** a developer can integrate without reading application source.

## API-04 — Python SDK

Typed resources, authentication, pagination iterators, pandas conversion, bulk upload/download, idempotent mutation helpers, stable exceptions, version compatibility and optional async where useful.

**Exit:** scientific Python users can treat Sheetbase as a normal data platform without hand-writing HTTP.

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
