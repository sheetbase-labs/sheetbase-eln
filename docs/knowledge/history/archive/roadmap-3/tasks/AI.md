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

## AI-04 — Real providers, workspace policy, MCP and the assistant

**Status (2026-10-24):** Implemented on `feat/ai-everything`, rebased onto
`ab784848`. The provider adapters (OpenRouter, Anthropic Messages, generic
OpenAI-compatible and local endpoints) are real, but **no external provider
was called by this change**: they are verified with injected `fetch` and
recorded response fixtures. Live-provider quality, latency and cost remain
unexercised. The MCP server was exercised over loopback against a disposable
personal token. See [`docs/operations/ai.md`](../../../../../operations/ai.md).

### Scope

- real provider adapters behind the AI-03 `ModelProvider` contract;
- deployment profiles with server-side key resolution and fail-closed
  validation, selected by a workspace policy in `api.workspace_settings`;
- workspace kill switch, cloud-egress consent and per-call token/cost caps;
- one global assistant surface plus page-header entry points, grounded in the
  AI-01 envelope and labelled with its sources;
- an authenticated MCP server over the existing AUTO-PLUS tool catalogue, plus
  domain resources, prompts and coding-agent skills from one manifest;
- draft tools require `agent_operations:write` **and** the operation's write
  scope, so an under-scoped token cannot trigger an auto-executed write.

### Exit

A workspace owner can select a configured provider or the built-in model,
bound every call, and a member can ask a grounded question from any core page
and see the cited sources. An external agent can authenticate with a personal
token, discover only its scoped tools, read canonical data and propose drafts
through the existing approval path. No agent can sign, approve or execute.

### Limits

- No live vendor call, streaming, retry, embeddings index or monthly spend
  counter.
- BYO workspace keys and MCP OAuth discovery are not implemented.
- The browser evidence uses the built-in deterministic model, so it proves the
  pipeline and UI, not model-answer quality.

## Boundaries

- AI context never grants access beyond the requesting actor.
- Model output is not authoritative scientific state until a canonical operation validates/commits it.
- Do not build a parallel AI-only data store as scientific authority.
