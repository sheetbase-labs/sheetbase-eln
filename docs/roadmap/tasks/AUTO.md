# AUTO — Automation

**Status:** AUTO-01/02/03 complete (deterministic Pipelines); AUTO-04/05
later.

## Programme goal

Add deterministic Pipeline capabilities and later agent-assisted scientific operations using the same canonical Sheetbase domain contracts as humans, SDKs and integrations.

Automation is a normal roadmap workstream. It is sequenced later because it builds naturally on the data, API, governance and operational capabilities developed in earlier streams; it is not a special or exceptional programme.

## AUTO-01 — Pipeline Foundation

Versioned Pipeline Definitions and Runs; typed parameters; explicit Dataset/Dataset Version inputs; configured transformations; output contracts; provenance; validation; execution identity.

**Exit:** a versioned transformation has explicit inputs/outputs and a durable reproducibility/provenance contract.

**Complete.** See `docs/pipelines.md` and ADR 0042. Versioned Definitions
mirror Sheet Definitions (draft → published → retired); runs pin the exact
version, parameters and input Dataset Version ids; `pipeline_run_outputs`
normalizes provenance; the sha-256 input digest makes identical manual runs
idempotent.

## AUTO-02 — Deterministic Execution & Triggers

SQL/Python execution boundary; manual runs; schedules; event triggers; retries; idempotency; concurrency; cancellation; run history; logs; status; resource/time limits; failure handling.

**Exit:** deterministic Pipelines execute reliably and can be triggered manually, on schedule or by supported events.

**Complete (SQL boundary).** The transform runs server-side inside the
zero-grant `pipeline_worker` sandbox (temp-schema search_path, fixed 60s
timeout, 100k-row cap, static single-SELECT validation). Manual, interval,
daily and `dataset_version_created` event triggers work end-to-end;
retries/attempt lineage, digest idempotency, concurrency rejection,
cancellation, run history, append-only stage logs and bounded error codes
all mirror the connector run model. Python execution is a future transform
language behind the `transform.language` discriminator.

## AUTO-03 — Pipeline Authoring & Product Integration

Definition editor/configuration; code/config references; input/output mapping; validation; run/inspect/retry; links from Datasets/Notebooks; permissions.

**Exit:** users can configure and operate common transformations through a coherent product surface.

**Complete.** `/pipelines` catalogue, definition detail with draft
configuration editor (inputs, typed parameters, SQL statement, output
schema/mapping), publish/retire versions, run history with Run/Retry/Cancel
and inspect (stage logs + output Dataset Versions), and schedule management.
No visual DAG builder — a single-transform editor per the task's guidance.
Pipeline Dataset outputs are linked from the Dataset surface via
`pipeline_run_outputs`.

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
