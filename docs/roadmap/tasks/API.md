# API — API & Developer Platform

**Status:** PC-00 accepted; API-01 is **Low** and **Ready** in parallel with PC-01. Stay at the contract boundary unless a later epic is queued.

## Programme goal

Make Sheetbase programmable through a deliberate public domain API rather than exposing internal PostgreSQL/PostgREST implementation details as the integration contract.

The browser is one client of the domain, not the privileged definition of it.

## API-01 — Public API Contract

**Priority:** low. **Status:** Ready (parallel with PC-01).

### Goal

Define stable, versioned resources and operations for external clients.

### Accepted PC-00 decisions

- Retire `scientific:*` as the **future** public API scope model.
- Design scopes and contracts around **canonical Core resources and capabilities** (Models, Records, Dataset Schemas, Datasets/Versions, Sheet Definitions/Instances, Notebooks/Templates, files).
- Do not perpetuate the removed scientific-table architecture.
- If real existing clients depend on old scopes, define an explicit **migration/deprecation path**. Do not make those scopes the future contract.
- This epic is **contract / audit / documentation**. Inspect the actual server and `/api/db` / token allowlist implementation.
- If implementation requires consequential server architecture, migrations, RLS, transactions or other Medium-level work, **stop at the contract boundary** and queue that implementation separately.

### Current state (PC-00)

External credentials and `POST /api/token` exist. The allowlist is **project-domain only** (`src/lib/external-token.ts`). Core Dataset/Sheet/Notebook RPCs fail closed. `scientific:*` scopes are mintable but map to an empty resource set. `docs/external-api.md` still documents removed scientific-table CLI — correct it here.

The browser session path has no allowlist; do not treat PostgREST exposure as the public contract.

### Deliverables

- public resource/operations contract;
- Core-domain scope proposal (not `scientific:*`);
- compatibility/deprecation plan;
- corrected external API documentation.

Start from the RPCs the product should use, not by opening tables.

### Contract requirements

Versioning; stable identity; pagination; filtering/sorting; bulk operations; structured validation errors; stable error codes; optimistic concurrency; idempotency; retry semantics; lifecycle; version access; permission errors; rate limits; deprecation policy.

### Exit

A developer can read the intended public contract without treating scientific-table REST as current. Implementation of a new allowlist/scope cut-over is queued if it exceeds Low contract work.

## API-02 — API Credentials & Service Identity

Personal tokens; service accounts; workspace binding; capability scopes; expiry; rotation; revocation; last-used metadata; credential audit; request attribution; safe secret handling.

PC-00: `createCredential` exists in `src/lib/api-credentials.ts` with **no product UI**. Do this after API-01 scope vocabulary is honest.

**Exit:** external automation authenticates safely without borrowing human sessions or database credentials.

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
