# AI — Contextual Scientific Intelligence Substrate

**Status (2026-09-07):** AI-01..03 substrate implementation merged on `main` (#153..155). AI-03 implements a policy/observability boundary with `StubModelProvider`; real vendor integration and real-provider evaluation are **not implemented by this work**. See [`src/lib/ai-gateway.ts`](../../../../../../src/lib/ai-gateway.ts), the [reconciled status index](README.md) and [`../../NEXT.md`](../../../../NEXT.md). Merged is not unqualified product acceptance.

## Programme goal

Create a trustworthy context/retrieval substrate for AI features that respects canonical Sheetbase identity and permissions.

## AI-01 — Context Assembly Contract

### Goal

Define how canonical Sheetbase context is assembled for intelligent features.

### Scope

- workspace/project/object context from stable IDs;
- Notebook/Sheet/Dataset/Record/analysis/provenance summaries;
- explicit version/evidence context;
- bounded token/context budgets;
- permission checks before material reaches the model.

### Exit

A documented/tested context service can assemble relevant permitted scientific context without scraping UI state or bypassing server permissions.

## AI-02 — Knowledge Retrieval & Citation

### Goal

Enable grounded retrieval across permitted Sheetbase knowledge/scientific objects.

### Scope

- search/retrieval over canonical text/metadata/content where appropriate;
- citations/links back to source objects and versions;
- freshness/lifecycle handling;
- evaluate retrieval quality on representative scientific questions;
- no cross-workspace leakage.

### Exit

AI features can retrieve and cite relevant Sheetbase sources with measurable quality and permission isolation.

## AI-03 — Model Gateway, Policy & Observability

### Goal

Provide one governed model-call boundary for product AI features.

### Scope

- provider/model abstraction only where useful;
- prompt/context logging policy with sensitive-data controls;
- cost/latency/error telemetry;
- model/tool allowlists and configurable limits;
- reproducible evaluation fixtures for consequential features.

### Exit

AI calls run through a visible, testable policy/observability boundary rather than ad-hoc feature-specific provider calls.

## Boundaries

- AI context never grants access beyond the requesting actor.
- Model output is not authoritative scientific state until a canonical operation validates/commits it.
- Do not build a parallel AI-only data store as scientific authority.
