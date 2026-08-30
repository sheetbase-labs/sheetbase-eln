# Roadmap 3 Tasks — Open Platform

## Programme outcome

Make Sheetbase cleanly extensible through stable developer surfaces that expose canonical product semantics rather than requiring external clients to recreate them.

---

## SDK-01 — SDK Product Maturity

### Problem

Roadmap 2 API-04/05 establish initial Python and TypeScript SDKs. Roadmap 3 should turn those into mature developer products rather than thin request wrappers.

### Scope

- ergonomic typed clients over the canonical public API;
- stable resource/operation naming aligned across Python and TypeScript;
- pagination, retries, idempotency, validation and structured errors;
- high-level helpers only where they compose public operations without reproducing server business logic;
- examples for Dataset/Sheet/Record/Notebook/Template/analysis/Pipeline workflows;
- versioning/deprecation policy appropriate to a maturing pre-release platform;
- parity tests against the OpenAPI/public contract.

### Non-goals

- SDK-only business rules;
- shadow domain objects with different semantics from server resources;
- direct database access;
- preserving superseded pre-release SDK APIs without a current need.

### Dependencies

Roadmap 2 API-04 and API-05 complete.

### Required evidence

- generated/contract parity checks;
- representative end-to-end SDK workflow tests in both languages;
- error/permission/version semantics match server behaviour;
- documentation examples execute against the supported API.

### Exit criterion

Python and TypeScript developers can perform representative Sheetbase workflows through coherent, documented, tested SDKs without learning transport details or recreating domain rules locally.

---

## EVENT-01 — Event & Webhook Platform Maturity

### Problem

Roadmap 2 API-06 establishes webhooks. A mature platform needs stable event semantics, delivery guarantees and operational visibility that align with canonical domain changes.

### Scope

- stable event envelope and naming across canonical object classes;
- subscription filtering/scoping by workspace and supported event type;
- signing, retries, delivery history and replay within explicit retention limits;
- idempotency/deduplication guidance;
- event payload versioning and minimal canonical identifiers/provenance;
- operational UI/API for webhook health;
- clear distinction between change notification and frozen scientific evidence.

### Non-goals

- event sourcing as the database architecture;
- treating change events as evidence snapshots;
- publishing internal implementation noise as public events;
- vendor-specific event models.

### Dependencies

Roadmap 2 API-06 complete; canonical change/audit events where applicable.

### Required evidence

- signed-delivery verification tests;
- retry/replay/idempotency tests;
- permission/isolation tests;
- event compatibility tests across supported object changes.

### Exit criterion

External systems can reliably subscribe to stable, permission-scoped Sheetbase domain events with observable delivery/retry behaviour and without confusing notifications with scientific evidence.

---

## EXT-01 — Extension Model

### Problem

As the platform matures, integrations and specialised capabilities should be able to participate in the product without forks or direct coupling to internal UI/database implementation.

### Scope

- define supported extension points over canonical APIs, SDKs and events;
- initial extension manifest/identity/permissions model;
- extension actions or views only where they can be sandboxed and explicitly scoped;
- clear boundary between extensions, connectors and Pipelines;
- lifecycle/install/configuration model suitable for a single workspace initially;
- extension UI integration only through deliberate host surfaces, not arbitrary DOM/runtime mutation.

### Non-goals

- arbitrary plugin code with server/database access;
- duplicate connector or Pipeline framework;
- marketplace/commercial ecosystem before the extension contract is proven;
- vendor-specific first-class architecture.

### Dependencies

SDK-01 and EVENT-01. Security/capability review required for executable extension surfaces.

### Required evidence

- one or more representative extensions using only supported contracts;
- permission/sandbox boundary tests;
- uninstall/disable lifecycle behaviour;
- no shadow storage/domain model required for the example extension.

### Exit criterion

A third-party or internal extension can add a bounded capability to Sheetbase through documented, permission-aware extension points without direct coupling to internal database or application implementation.

---

## ADMIN-01 — Mature Platform Administration

### Problem

Existing configuration, governance and operational surfaces are sufficient for the current product but need consolidation for broader deployment and future institutional use.

### Scope

- coherent administration information architecture for users/memberships, capabilities, credentials, integrations, webhooks, storage/operational status and configuration ownership;
- distinguish scientist/Steward/admin responsibilities clearly;
- operational health and configuration visibility without exposing secrets;
- bulk/safe administrative actions where justified;
- auditability of consequential admin changes;
- groundwork for later organisation/GxP/ops tasks without implementing speculative hierarchy.

### Non-goals

- ENT-ORG organisation hierarchy;
- regulated workflow claims owned by GXP-01;
- duplicating Steward scientific configuration under generic admin;
- bypassing canonical capability/RLS enforcement.

### Dependencies

Existing GOV/PLAT/API/integration foundations; can progress alongside SDK/EVENT work.

### Required evidence

- role/capability boundary tests;
- admin change audit tests;
- no secret leakage through UI/API/logs;
- representative admin workflow browser tests.

### Exit criterion

Administrators can understand and safely operate the current Sheetbase platform from a coherent admin surface, while scientific configuration remains in the appropriate Steward/product surfaces and all authority remains server-side.
