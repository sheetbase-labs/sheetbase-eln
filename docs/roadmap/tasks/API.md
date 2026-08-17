# API — API & Developer Platform

**Status:** planned; refine after PC-00.

## Programme goal

Make Sheetbase programmable through a deliberate public domain API rather than exposing internal PostgreSQL/PostgREST implementation details as the integration contract.

The browser is one client of the domain, not the privileged definition of it.

## API-01 — Public API Contract

### Goal

Define stable, versioned resources and operations for external clients.

### Candidate resources

Models, Records, Dataset Schemas, Datasets/rows/Versions, Sheet Definitions/Instances, Notebooks/Templates and files.

### Contract requirements

Versioning; stable identity; pagination; filtering/sorting; bulk operations; structured validation errors; stable error codes; optimistic concurrency; idempotency; retry semantics; lifecycle; version access; permission errors; rate limits; deprecation policy.

### Exit

External clients can perform supported workflows without depending on internal table or RPC names.

## API-02 — API Credentials & Service Identity

Personal tokens; service accounts; workspace binding; capability scopes; expiry; rotation; revocation; last-used metadata; credential audit; request attribution; safe secret handling.

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
