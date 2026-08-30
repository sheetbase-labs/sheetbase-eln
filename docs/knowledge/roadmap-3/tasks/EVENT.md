# EVENT — Event & Webhook Platform Maturity

**Status:** planned; begins only after Roadmap 2 API-06 establishes initial webhook delivery.

## Programme goal

Turn initial webhooks into a coherent event platform for reliable external coordination and automation.

## EVENT-01 — Canonical Event Catalogue

### Goal
Define stable event families around canonical Sheetbase domain changes.

### Scope
- event names/payload envelopes/version metadata;
- Record, Dataset/Version, Sheet, Notebook/review, Pipeline and administration events where justified;
- stable IDs and actor/provenance context;
- remove ambiguous implementation-event leakage.

### Exit
Consumers can understand a documented event catalogue without inferring meaning from database table changes.

## EVENT-02 — Delivery Operations & Replay

### Goal
Make event delivery operationally dependable.

### Scope
- delivery status/history;
- retry/backoff/dead-letter semantics;
- replay windows and idempotency identifiers;
- endpoint health/disablement and diagnostics;
- observability and rate controls.

### Exit
Operators can diagnose, replay and recover failed event delivery without manually editing database state.

## EVENT-03 — Event Consumption for Platform Automation

### Goal
Use the same event semantics consistently across webhooks, Pipelines and future extensions.

### Scope
- map supported events to canonical Pipeline/event triggers;
- SDK event types/helpers;
- permission/workspace isolation tests;
- prevent separate internal and external event vocabularies where one domain event suffices.

### Exit
External webhooks and Sheetbase automation can react to the same documented domain events with consistent identity and provenance semantics.

## Boundaries

- Events describe canonical domain changes; they do not become a second audit/evidence store.
- Delivery retries must not duplicate downstream effects when consumers use event/idempotency identifiers correctly.
