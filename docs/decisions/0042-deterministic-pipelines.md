# 0042. Deterministic Pipelines

- **Status:** accepted
- **Date:** 2026-08-28
- **Tickets:** AUTO-01, AUTO-02, AUTO-03

## Context

The roadmap (tasks/AUTO.md) requires deterministic Pipeline capabilities
using the same canonical Sheetbase domain contracts as humans, SDKs and
integrations: versioned Definitions and Runs, typed parameters, explicit
Dataset/Dataset Version inputs, configured transformations, output contracts,
provenance, validation, execution identity, and later schedules/event
triggers with retries, idempotency, concurrency, cancellation and bounded
limits. The pre-release rule forbids a second Dataset/execution/evidence
model, and no production users exist to justify compatibility surfaces.

## Decision

1. **Versioned Definitions mirror the Sheet Definition pattern.**
   `api.pipeline_definitions` (identity) + `api.pipeline_definition_versions`
   (immutable `configuration` JSONB, draft → published → retired). Runs may
   only start from published versions; every run pins the exact version that
   produced it.

2. **Runs mirror the connector run model.** `api.pipeline_runs` reuse the
   connector vocabulary — manual/scheduled/event trigger kinds, running/
   succeeded/failed (+ `cancelled` for cancellation), attempt/retry lineage
   via `retry_of_run_id`, sha-256 digest idempotency receipts with
   concurrent-duplicate rejection, the fixed staleness threshold for abandoned
   running attempts, user XOR credential actor attribution, and append-only
   stage logs (`api.pipeline_run_logs`). Outputs are normalized provenance in
   `api.pipeline_run_outputs` linking the run to the Dataset Versions it
   produced.

3. **The transform is one deterministic SQL SELECT, sandboxed by a
   low-privilege role, not by text parsing.** Input Dataset Versions are
   materialized into session temp tables by the trusted application
   connection; the transform executes as the zero-grant `pipeline_worker`
   role with `search_path` pinned to the temp schema and a fixed
   `statement_timeout`. Static validation (single SELECT, no comments/
   semicolons/DDL/schema-qualified names/`pg_*`) is defense-in-depth and
   better errors, not the security boundary. Python execution is a future
   transform language; the `transform.language` discriminator leaves the door
   open without shipping an unsandboxed runtime.

4. **Outputs land only through canonical governed operations.** The executor
   stamps the run actor's JWT claims and calls `commit_dataset_row_batch`
   and `snapshot_dataset` — the same SECURITY DEFINER RPCs the browser uses —
   so Pipeline output never bypasses Dataset Schema validation, coercion or
   evidence immutability.

5. **Execution is server-side.** The transform cannot run in the browser; a
   same-origin route (`POST /api/pipelines/execute`) executes started runs,
   and the background sweep (`pipeline-scheduler.server.ts`) fires scheduled
   and event-triggered runs against the latest published version. Event
   delivery is a polling approximation over the durable `change_events`
   stream, consumed exactly once per event.

6. **Permissions.** `pipelines.manage` (owner/admin/steward) for authoring
   and schedules; any workspace writer starts/cancels runs; viewers read.
   Pipeline tables are RPC-write-only and the external `api_client` surface
   is not granted Pipeline access.

## Consequences

- One canonical automation model with no compatibility shims: no second
  Dataset writer (output creation uses the RLS-gated `authenticated` path),
  no browser-side execution, no ungoverned schedule engine.
- Deterministic, reproducible runs with explicit input/parameter/output
  contracts, at the cost of a deliberately narrow v1 transform language
  (SQL only — scope revised from the original SQL+Python brief; Python sits
  behind `transform.language`) and polling-based event delivery.
- Run identity is authoritative: the canonical `input_digest` is computed
  server-side; scheduled/event runs add a stable trigger occurrence identity
  so duplicate sweeps dedupe, crashes reconcile, and failed event starts are
  durable and retried rather than silently lost.
- The `pipeline_worker` sandbox role must exist in every cluster
  (docker/db/init/00-roles.sh / .agents/setup); migrations cannot create
  roles.
- Runs are terminal-state evidence: completed runs, their logs and their
  outputs are immutable.
