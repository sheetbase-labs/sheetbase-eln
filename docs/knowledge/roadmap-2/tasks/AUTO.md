# AUTO — Automation

**Status:** complete.

## Programme goal

Add deterministic Pipeline capabilities and later agent-assisted scientific operations using the same canonical Sheetbase domain contracts as humans, SDKs and integrations.

Automation is a normal roadmap workstream. It is sequenced later because it builds naturally on the data, API, governance and operational capabilities developed in earlier streams; it is not a special or exceptional programme.

## AUTO-01 — Pipeline Foundation

Versioned Pipeline Definitions and Runs; typed parameters; explicit Dataset/Dataset Version inputs; configured transformations; output contracts; provenance; validation; execution identity.

**Exit:** a versioned transformation has explicit inputs/outputs and a durable reproducibility/provenance contract.

**Complete.** See `docs/pipelines.md` and ADR 0042. Versioned Definitions
mirror Sheet Definitions (draft → published → retired); runs pin the exact
version, parameters and input Dataset Version ids; `pipeline_run_outputs`
normalizes provenance. The canonical run identity (`input_digest`) is
computed **server-side** from (definition version, canonical parameters,
input Dataset Versions) — callers can never choose or forge it, so replay,
concurrency and retry decisions are authoritative.

> **Scope revision (v1, deliberate):** the v1 transform language is **SQL
> only**. The original AUTO-01/02 brief listed SQL + Python as initial
> execution types; we have explicitly revised the exit scope to SQL-first
> because shipping an unsandboxed Python runtime would violate the
> deterministic-execution and governance requirements. Python sits behind the
> `transform.language` discriminator as a future transform language (ADR
> 0042). This revision is recorded so the bundle does not claim the original
> SQL+Python scope.

## AUTO-02 — Deterministic Execution & Triggers

SQL/Python execution boundary; manual runs; schedules; event triggers; retries; idempotency; concurrency; cancellation; run history; logs; status; resource/time limits; failure handling.

**Exit:** deterministic Pipelines execute reliably and can be triggered manually, on schedule or by supported events.

**Complete (SQL boundary).** The transform runs server-side inside the
zero-grant `pipeline_worker` sandbox (temp-schema search_path, fixed 60s
timeout + driver-level backstop, 100k-row cap, static single-SELECT
validation). Manual, interval, daily (explicit IANA time zone) and
`dataset_version_created` event triggers work end-to-end. Scheduled and
event-triggered runs carry a **stable trigger occurrence identity**
(`sched:<id>:<due_at>` / `evt:<change_event_id>`) so duplicate sweeps dedupe,
a crash between start and execute is reconciled by the staleness threshold
and retried as a linked attempt, and failed event starts are **not silently
consumed**: the per-workspace event cursor advances only with a durable
disposition (started run or explicitly abandoned failure after the retry
budget, recorded in `pipeline_trigger_failures`). Retries/attempt lineage,
digest idempotency (manual runs), concurrency rejection, cancellation, run
history, append-only stage logs and bounded error codes all mirror the
connector run model. Python execution is a future transform language behind
the `transform.language` discriminator (scope revision recorded under
AUTO-01).

## AUTO-03 — Pipeline Authoring & Product Integration

Definition editor/configuration; code/config references; input/output mapping; validation; run/inspect/retry; links from Datasets/Notebooks; permissions.

**Exit:** users can configure and operate common transformations through a coherent product surface.

**Complete.** `/pipelines` catalogue, definition detail with draft
configuration editor (inputs, typed parameters, SQL statement, output
schema/mapping), publish/retire versions, run history with Run/Retry/Cancel
and inspect (stage logs + output Dataset Versions), and schedule management
(interval / daily-with-IANA-timezone / event). **Product hand-offs:**
`/datasets` gains a **Pipelines** tab listing every published single-input
Pipeline with a Run action pre-filled with the Dataset's latest Version;
Sheet Instances with a bound Dataset offer "Run Pipelines on this Dataset"
(→ the Dataset Pipelines tab); notebooks can insert a **pipeline_output
block** that references a Pipeline run and pins its produced Dataset Version
(with run/output links). No visual DAG builder — a single-transform editor
per the task's guidance.

## AUTO-04 — Agent-authored Operations

Agents propose schema/Definition/Pipeline/data operations through normal APIs; preview/diff; user approval where required; same validation/capabilities; provenance identifying agent/tool/model context appropriately.

**Exit:** agent-authored changes are inspectable and produce the same evidence as human/code-authored operations.

**Complete.** Typed, single-operation proposals cover canonical Dataset Schema
draft creation, Sheet Definition draft creation/update, Pipeline
Definition/draft creation/update, and Dataset row commits. PostgreSQL derives
the deterministic preview and impact, binds idempotency to an exact request,
and applies optimistic proposal and target revisions. `/agent-operations`
provides a dense inspection, approval, rejection, execution, provenance and
evidence timeline.

Every operation requires approval and execution from a human session holding
the underlying canonical capability. Execution delegates to the existing
Dataset Schema, Sheet Definition, Pipeline Definition/version or
`commit_dataset_row_batch` RPC, so validation, permissions, canonical audit
events and immutable published/evidence boundaries remain unchanged. Publish,
submit, sign, amend and lock operations are excluded. Multi-step goal
orchestration remains AUTO-05. See ADR 0043.

## AUTO-05 — Agentic Scientific Workflows

Multi-step goal-driven operations over authorised Sheetbase primitives; bounded toolset; explicit approval boundaries; recovery; reproducibility; cost/usage visibility; no silent destructive action.

**Exit:** agents can assist with meaningful scientific workflows without creating a parallel shadow system.

**Complete.** Agents can submit digest-pinned plans containing 2 to 20
sequential typed AUTO-04 operations with immutable Dataset Version or
published Pipeline Version input references. PostgreSQL validates the full
plan and creates one proposal at a time. Every mutation still requires a
human to approve and execute its proposal with the underlying canonical
capability.

Workflows pause on rejection or failure. Human-only resume reproposes the same
pinned operation; cancellation and budget exhaustion invalidate pending or
approved proposals. Operation, token, and cost budgets and usage remain
visible with append-only workflow events. `/agent-operations` joins the
workflow plan, attempts, references, budgets, provenance, and proposal
evidence in one product workflow. External agents can submit, inspect,
advance, report usage for, and cancel workflows they created, but cannot
resume or cross an approval boundary. See ADR 0043 and
`docs/agent-workflows.md`.

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
