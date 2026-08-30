# Pipelines

Pipelines run deterministic, versioned transformations over canonical
Datasets. A Pipeline is a workspace-scoped identity with immutable published
versions. Every run pins the exact definition version, parameters, and input
Dataset Version ids. The run executes one deterministic SQL transform inside
a low-privilege sandbox. The output lands only through the canonical governed
Dataset operations (`commit_dataset_row_batch` / `snapshot_dataset`).

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
  `timestamp`). The transform references them as `{{name}}` placeholders. The
  runner substitutes them as safe SQL literals. Required parameters have no
  default.
- **Inputs** name the temp tables that the transform reads. At run start,
  each input is pinned to an immutable Dataset Version (not a live Dataset).
  This makes the run reproducible.
- **The transform is exactly one deterministic `SELECT`** (optionally with a
  leading `WITH`). Comments, semicolons, dollar-quoting, schema-qualified
  names, `pg_*`/`lo_*` functions and DDL/DML keywords are rejected.
- **Output columns** must match the output Schema's field slugs (stable,
  immutable within a Schema Version), or be mapped explicitly with
  `fieldMapping`. Every non-nullable field must be produced. Extra columns
  are rejected, not silently dropped. In v1 transforms, multi-valued fields
  expose their first value.

## Execution boundary (AUTO-02)

Transforms run server-side (`src/lib/pipeline-execute.server.ts`) inside a
dedicated **`pipeline_worker`** session role. The role has:

- zero table grants (the transform can read only its own temp tables),
- a `search_path` pinned to the session temp schema,
- a fixed `statement_timeout` (60s) and a 100,000-row result cap,
- static statement validation as defense-in-depth.

The trusted application connection materializes input Dataset Versions into
session temp tables. The sandbox role gets SELECT on exactly those tables.
Outputs are written with the run actor's JWT claims through the **same
governed RPCs the browser uses** — `commit_dataset_row_batch` then
`snapshot_dataset` — never through a second writer.

## Run lifecycle

1. **Start** — `api.start_pipeline_run` (workspace writer; only published
   versions run). **The server computes the canonical run identity** —
   sha-256 over (definition version, canonical parameters, canonical input
   Dataset Versions). The caller never supplies it. Replay, concurrency, and
   retry decisions are therefore authoritative. Manual runs dedupe by this
   digest: a prior success replays, a concurrent duplicate conflicts
   (`SB044`), and a failed attempt requires an explicit `retry_of_run_id`
   (`SB045`). The system reconciles abandoned running attempts after a fixed
   staleness threshold. Scheduled and event runs instead carry a **stable
   trigger occurrence identity** (`sched:<id>:<due_at>` /
   `evt:<change_event_id>`) and dedupe by occurrence: one running and one
   succeeded run per occurrence. When a run starts but never executes, the
   sweep reconciles it and retries it as a linked attempt.
2. **Execute** — `POST /api/pipelines/execute` runs the transform and
   completes or fails the run. Cancellation takes effect at the next safe
   point (`cancel_pipeline_run`). In-flight execution finishes. Only the run
   actor can finalize a run. The executor re-stamps the run actor's identity
   after the transform. The output phase therefore never inherits claims that
   the transform chose. The executor creates the output Dataset through the
   **canonical RLS-gated writer path** (`authenticated` role,
   `datasets_insert_writer` policy) — never a privileged second writer. A
   driver-level query timeout backs up the statement timeout.
3. **Record** — succeeded runs carry `rowCount`, output Dataset/Version ids,
   and the output label in `result`. Outputs are also normalized in
   `pipeline_run_outputs` for reverse lookup from Dataset pages.

## Trigger reliability

- **Duplicate sweeps** never double-start the same occurrence. There is one
  running and one succeeded run per `trigger_occurrence_id`.
- **Crash recovery** (scheduled and event runs): a run that started but never
  executed stays `running` for at most the 900s staleness threshold. Runs
  link back to their `schedule_id`. The next sweep fails any stale running
  run for that schedule with `stale_run_reconciled`. It then starts a linked
  retry of the **same** `trigger_occurrence_id` and the same pinned Pipeline
  Definition Version. The retry uses the crashed run's own stored version,
  inputs, and parameters. It does not depend on the schedule's current
  `next_run_at` or event cursor. The system therefore recovers a crashed
  occurrence reproducibly. It never silently skips the occurrence, and it
  never silently upgrades it to a newer version. Only genuinely NEW
  occurrences resolve the latest published version. The event cursor does not
  move backwards.
- **Event delivery is at-least-once, not silently lossy.** The per-workspace
  `change_events` sequence cursor advances when a run starts. If that run's
  execution crashes, the sweep recovers it by its `evt:<event_id>` identity.
  A failed run _start_ keeps the cursor in place, records the failure in
  `api.pipeline_trigger_failures`, and retries on the next sweep. After the
  retry budget, the system explicitly **abandons** the trigger (visible in
  the failures table) and the cursor advances.

## Triggers

- **Manual** — from the Pipeline definition page (Run/Retry buttons) or from
  a Dataset's Pipelines tab.
- **Schedule** — interval (every N minutes) or daily (HH:MM in an **explicit
  IANA time zone**, default UTC — never the server's zone). Schedules run the
  **latest published version** with the schedule's fixed inputs and
  parameters. The server sweep (`pipeline-scheduler.server.ts`) evaluates
  them every 60s. Schedule rows lock only for the start decision, so a long
  run never blocks the next tick.
- **Event** — `dataset_version_created` schedules fire when the platform
  sweep observes matching `change_events` (optionally filtered to one
  Dataset). Delivery is a polling approximation, but **at-least-once**. The
  cursor advances only with a durable disposition. Failures are recorded in
  `api.pipeline_trigger_failures` and retried. Abandonment after the budget
  is explicit and visible.

## Product integration

- **Dataset → Pipeline**: the `/datasets` Pipelines tab lists every published
  single-input Pipeline. Its Run action comes pre-filled with the Dataset's
  latest Version id.
- **Sheet → Pipeline**: a Sheet Instance with a bound Dataset offers "Run
  Pipelines on this Dataset". The link lands on that Dataset's Pipelines tab.
- **Notebook → Pipeline**: a `pipeline_output` notebook block references a
  Pipeline run. It pins the Dataset Version that the run produced (run +
  Dataset links; empty drafts are allowed).

## Permissions

- **`pipelines.manage`** (owner/admin/steward): create and edit definitions,
  create/publish/retire versions, manage schedules, cancel any run, write run
  logs.
- **Any workspace writer**: start manual runs, run and inspect history,
  cancel their own runs.
- **Run actor only**: finalize a run (complete/fail), record outputs, and
  write stage logs. A non-actor writer can never forge a success result or
  inject misleading evidence. The executor runs as the run actor's identity.
- **Viewer**: read-only.
- Pipeline tables are read-only for request roles (RPCs only). The external
  `api_client` credential surface has **no** Pipeline access — the Pipeline
  API is out of scope for the external contract.

## Reproducibility

Same definition version + same parameters + same pinned input Dataset
Versions = same logical output. Identical manual requests replay
idempotently. The result keeps the row order from the transform's `ORDER
BY`. Where no order is specified, row order is not part of the contract.

## Limits (v1, fixed)

| Limit                        | Value   |
| ---------------------------- | ------- |
| Transform statement length   | 20,000  |
| Transform execution time     | 60s     |
| Result rows per run          | 100,000 |
| Input rows per input version | 100,000 |
| Input schema fields          | 256     |
| Parameters / inputs          | 50 / 10 |
