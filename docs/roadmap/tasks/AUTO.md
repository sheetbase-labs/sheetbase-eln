# AUTO — Automation

**Status:** deferred.

## Programme goal

Add deterministic and later agentic automation only after human workflows, public operations, service identity, evidence semantics and observability are mature.

## Readiness gate

Do not start broad AUTO work until:

- canonical human workflows are coherent;
- public domain operations are stable;
- service identity exists;
- import/export and evidence semantics are mature;
- observability can diagnose failed automation;
- permissions/provenance are consistent across UI and API;
- deterministic transformation semantics are understood.

## AUTO-01 — Deterministic Pipeline Foundation

Versioned Pipeline Definitions; typed parameters; immutable Dataset Version inputs where required; configured transforms; SQL/Python execution boundary; Dataset outputs; provenance; validation; execution identity.

**Exit:** a versioned transformation reproducibly consumes explicit inputs and produces traceable outputs.

## AUTO-02 — Pipeline Execution & Triggers

Manual runs; schedules; event triggers; retries; idempotency; concurrency; cancellation; run history; logs; status; resource/time limits; failure handling.

**Exit:** deterministic Pipelines can operate reliably without manual babysitting.

## AUTO-03 — Pipeline Authoring & Product Integration

Definition editor/configuration; code/config references; input/output mapping; validation; run/inspect/retry; links from Datasets/Notebooks; permissions.

Do not begin with a giant visual DAG builder.

**Exit:** users can configure and operate common transformations through a coherent product surface.

## AUTO-04 — Agent-authored Operations

Agents propose schema/Definition/Pipeline/data operations through normal APIs; preview/diff; user approval where required; same validation/capabilities; provenance identifying agent/tool/model context appropriately.

**Exit:** agent-authored changes are inspectable and produce the same evidence as human/code-authored operations.

## AUTO-05 — Agentic Scientific Workflows

Multi-step goal-driven operations over authorised Sheetbase primitives; bounded toolset; explicit approval boundaries; recovery; reproducibility; cost/usage visibility; no silent destructive action.

**Exit:** agents can assist with meaningful scientific workflows without creating a parallel shadow system.

## Principle

```text
Browser
Python SDK
Integration
Pipeline
Agent
    |
    v
same governed Sheetbase domain operations
    |
    v
PostgreSQL / RLS / validation / provenance / evidence
```
