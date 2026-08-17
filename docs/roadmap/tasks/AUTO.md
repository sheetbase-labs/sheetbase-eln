# AUTO — Automation

**Status:** planned; later roadmap stream.

## Programme goal

Add deterministic Pipeline capabilities and later agent-assisted scientific operations using the same canonical Sheetbase domain contracts as humans, SDKs and integrations.

Automation is a normal roadmap workstream. It is sequenced later because it builds naturally on the data, API, governance and operational capabilities developed in earlier streams; it is not a special or exceptional programme.

## AUTO-01 — Pipeline Foundation

Versioned Pipeline Definitions and Runs; typed parameters; explicit Dataset/Dataset Version inputs; configured transformations; output contracts; provenance; validation; execution identity.

**Exit:** a versioned transformation has explicit inputs/outputs and a durable reproducibility/provenance contract.

## AUTO-02 — Deterministic Execution & Triggers

SQL/Python execution boundary; manual runs; schedules; event triggers; retries; idempotency; concurrency; cancellation; run history; logs; status; resource/time limits; failure handling.

**Exit:** deterministic Pipelines execute reliably and can be triggered manually, on schedule or by supported events.

## AUTO-03 — Pipeline Authoring & Product Integration

Definition editor/configuration; code/config references; input/output mapping; validation; run/inspect/retry; links from Datasets/Notebooks; permissions.

Do not begin with a giant visual DAG builder unless later product evidence specifically supports one.

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
