# Pipelines

Deterministic, versioned transformations over canonical Datasets. A Pipeline
is a workspace-scoped identity with immutable published versions; every run
pins the exact definition version, parameters and input Dataset Version ids,
executes a single deterministic SQL transform inside a low-privilege sandbox,
and lands its output only through the canonical governed Dataset operations
(`commit_dataset_row_batch` / `snapshot_dataset`).

```text
Pipeline Definition
        │
        ▼
Versioned configuration (draft → published → retired)
        │
        ▼
Inputs (pinned Dataset Versions) + typed parameters
        │
        ▼
Deterministic SQL transform (sandboxed, bounded)
        │
        ▼
Canonical Dataset / Dataset Version output
        │
        ▼
Provenance: pipeline_run_outputs + append-only run history
```

## Concepts

| Concept                  | Table                              | Notes                                                            |
| ------------------------ | ---------------------------------- | ---------------------------------------------------------------- |
| Definition               | `api.pipeline_definitions`         | Stable `key` (immutable), name, description, lifecycle, revision |
| Version                  | `api.pipeline_definition_versions` | Append-only `configuration` JSONB; draft → published → retired   |
| Run                      | `api.pipeline_runs`                | Pins version + parameters + input versions; digest idempotency   |
| Run log                  | `api.pipeline_run_logs`            | Append-only stage/error log per run                              |
| Run output               | `api.pipeline_run_outputs`         | Normalized provenance: which Dataset Version a run produced      |
| Schedule / event trigger | `api.pipeline_schedules`           | interval / daily / dataset-version-created                       |

## Configuration format (v1)

```jsonc
{
  "configVersion": 1,
  "description": "Scale measurement values",
  "parameters": [
    { "name": "factor", "type": "decimal", "required": true },
    { "name": "note", "type": "text", "required": false, "default": "scaled" },
  ],
  "inputs": [{ "name": "measurements", "required": true }],
  "transform": {
    "language": "sql",
    "statement": "SELECT batch, value, value * {{factor}} AS scaled FROM measurements",
  },
  "output": {
    "mode": "create", // or "append"
    "schemaVersionId": "<uuid>", // required for create
    "datasetId": "<uuid>", // required for append
    "datasetName": "Scaled measurements", // required for create
    "datasetLabel": "pipeline output",
    "fieldMapping": null, // optional result-column → field-slug map
  },
}
```

Rules:

- **Parameters** are typed (`text`, `integer`, `decimal`, `boolean`, `date`,
  `timestamp`), referenced in the transform as `{{name}}` placeholders and
  substituted as safe SQL literals. Required parameters have no default.
- **Inputs** name the temp tables the transform reads. Each input is pinned
  to an immutable Dataset Version at run start (not a live Dataset), so the
  run is reproducible.
- **The transform is exactly one deterministic `SELECT`** (optionally with a
  leading `WITH`). Comments, semicolons, dollar-quoting, schema-qualified
  names, `pg_*`/`lo_*` functions and DDL/DML keywords are rejected.
- **Output columns** must match the output Schema's field slugs (stable,
  immutable within a Schema Version), or be mapped explicitly with
  `fieldMapping`. Every non-nullable field must be produced; extra columns
  are rejected rather than silently dropped. Multi-valued fields expose
  their first value in v1 transforms.

## Execution boundary (AUTO-02)

Transforms run server-side (`src/lib/pipeline-execute.server.ts`) inside a
dedicated **`pipeline_worker`** session role with:

- zero table grants (the transform can only read its own temp tables),
- a `search_path` pinned to the session temp schema,
- a fixed `statement_timeout` (60s) and a 100,000-row result cap,
- static statement validation as defense-in-depth.

Input Dataset Versions are materialized into session temp tables by the
trusted application connection; the sandbox role is granted SELECT on exactly
those tables. Outputs are written with the run actor's JWT claims through the
**same governed RPCs the browser uses** — `commit_dataset_row_batch` then
`snapshot_dataset` — never through a second writer.

## Run lifecycle

1. **Start** — `api.start_pipeline_run` (workspace writer; only published
   versions run). The **canonical run identity is computed server-side** —
   sha-256 over (definition version, canonical parameters, canonical input
   Dataset Versions) — never supplied by the caller, so replay, concurrency
   and retry decisions are authoritative. Manual runs dedupe by this digest:
   a prior success replays, a concurrent duplicate conflicts (`SB044`), a
   failed attempt requires an explicit `retry_of_run_id` (`SB045`), and
   abandoned running attempts are reconciled after a fixed staleness
   threshold. Scheduled/event runs instead carry a **stable trigger
   occurrence identity** (`sched:<id>:<due_at>` / `evt:<change_event_id>`)
   and dedupe by occurrence: one running + one succeeded run per occurrence,
   and a crashed occurrence (started but never executed) is reconciled by the
   sweep and retried as a linked attempt.
2. **Execute** — `POST /api/pipelines/execute` runs the transform and
   completes/fails the run. Cancellation is honoured at the next safe point
   (`cancel_pipeline_run`); in-flight execution finishes. Only the run actor
   can finalize a run; the executor re-stamps the run actor's identity after
   the transform (so the output phase never inherits claims the transform
   chose) and performs the output Dataset creation through the **canonical
   RLS-gated writer path** (`authenticated` role, `datasets_insert_writer`
   policy) — never a privileged second writer. A driver-level query timeout
   backs up the statement timeout.
3. **Record** — succeeded runs carry `rowCount`, output Dataset/Version ids
   and the output label in `result`; outputs are also normalized in
   `pipeline_run_outputs` for reverse lookup from Dataset pages.

## Trigger reliability

- **Duplicate sweeps** never double-start the same occurrence (one running +
  one succeeded run per `trigger_occurrence_id`).
- **Crash recovery** (scheduled and event runs): a run started but never
  executed stays `running` for at most the 900s staleness threshold. Runs
  link back to their `schedule_id`; the next sweep fails any stale running
  run for that schedule with `stale_run_reconciled` and starts a linked
  retry of the **same** `trigger_occurrence_id` **and the same pinned
  Pipeline Definition Version** (using the crashed run's own stored version,
  inputs and parameters) — independent of the schedule's current
  `next_run_at` or event cursor. A crashed occurrence is therefore
  recovered reproducibly, never silently skipped or silently upgraded to a
  newer version; only genuinely NEW occurrences resolve the latest published
  version. The event cursor does not move backwards.
- **Event delivery is at-least-once, not silently lossy**: the per-workspace
  `change_events` sequence cursor advances when a run starts; if that run's
  execution crashes, the sweep recovers it by its `evt:<event_id>` identity.
  A failed run _start_ keeps the cursor in place, records the failure in
  `api.pipeline_trigger_failures`, and is retried on the next sweep; after
  the retry budget it is explicitly **abandoned** (visible in the failures
  table) and the cursor advances.

## Triggers

- **Manual** — from the Pipeline definition page (Run/Retry buttons) or from
  a Dataset's Pipelines tab.
- **Schedule** — interval (every N minutes) or daily (HH:MM in an **explicit
  IANA time zone**, default UTC — never the server's zone) schedules run the
  **latest published version** with the schedule's fixed inputs and
  parameters. Evaluated by the server sweep (`pipeline-scheduler.server.ts`)
  every 60s; schedule rows are locked only for the start decision so a long
  run never blocks the next tick.
- **Event** — catalogue event schedules fire when the platform sweep
  observes a matching `change_events` row (optionally filtered to one
  Dataset for `dataset.versioned`). Any stable record/dataset/sheet/review
  event can trigger (`dataset.versioned`, `record.created`, `review.decided`,
  … — see `PIPELINE_TRIGGER_EVENTS` in `src/lib/pipeline-schedule.ts`).
  Delivery is a polling approximation, but **at-least-once**: the cursor
  advances only with a durable disposition, failures are recorded in
  `api.pipeline_trigger_failures` and retried, and abandonment after the
  budget is explicit and visible. Trigger configuration stores the canonical
  catalogue name (wire aliases and the legacy `dataset_version_created`
  spelling are accepted at intake and normalized). Only `dataset.versioned`
  supplies an input version; other events fire with the schedule's
  configured inputs. See the [event catalogue](../api/event-catalogue.md)
  for the full vocabulary.

## Product integration

- **Dataset → Pipeline**: the `/datasets` Pipelines tab lists every published
  single-input Pipeline with a Run action pre-filled with the Dataset's
  latest Version id.
- **Sheet → Pipeline**: a Sheet Instance with a bound Dataset offers "Run
  Pipelines on this Dataset", landing on that Dataset's Pipelines tab.
- **Notebook → Pipeline**: a `pipeline_output` notebook block references a
  Pipeline run and pins the Dataset Version it produced (run + Dataset
  links; empty drafts allowed).

## Permissions

- **`pipelines.manage`** (owner/admin/steward): create/edit definitions,
  create/publish/retire versions, manage schedules, cancel any run, write run
  logs.
- **Any workspace writer**: start manual runs, run/inspect history, cancel
  their own runs.
- **Run actor only**: finalizing a run (complete/fail), recording outputs and
  writing stage logs — a non-actor writer can never forge a success result or
  inject misleading evidence. The executor runs as the run actor's identity.
- **Viewer**: read-only.
- Pipeline tables are read-only for request roles (RPCs only); the external
  `api_client` credential surface is **not** granted Pipeline access — the
  Pipeline API is out of scope for the external contract.

## Reproducibility

Same definition version + same parameters + same pinned input Dataset
Versions = same logical output, with idempotent replay for identical manual
requests. Row order in the result is preserved from the transform's `ORDER
BY`; where no order is specified, row order is not part of the contract.

## Limits (v1, fixed)

| Limit                        | Value   |
| ---------------------------- | ------- |
| Transform statement length   | 20,000  |
| Transform execution time     | 60s     |
| Result rows per run          | 100,000 |
| Input rows per input version | 100,000 |
| Input schema fields          | 256     |
| Parameters / inputs          | 50 / 10 |
