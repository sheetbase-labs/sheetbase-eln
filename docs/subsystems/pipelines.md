# Pipelines

Versioned automation across the ELN. A Pipeline has a workspace identity and
immutable published versions. A run pins its definition, parameters, Dataset
Version inputs (when used), and Python runtime. Analysis, Dataset output and ELN
actions are optional; an action-only workflow needs no Dataset.

```text
Manual / scheduled / ELN event / authenticated webhook
                         │
                  Published version
                         │
           Optional SQL / Python analysis steps
                         │
               Optional Dataset output
                         │
                 Governed ELN actions
                         │
          Commit results + signed webhook outbox
                         │
               Delivery with retry/replay
```

This extends [ADR-0042](../knowledge/decisions/0042-deterministic-pipelines.md)
under [ADR-0046](../knowledge/decisions/0046-python-and-eln-pipeline-actions.md).

## Concepts

| Concept                  | Table                              | Notes                                                            |
| ------------------------ | ---------------------------------- | ---------------------------------------------------------------- |
| Definition               | `api.pipeline_definitions`         | Stable `key` (immutable), name, description, lifecycle, revision |
| Version                  | `api.pipeline_definition_versions` | Append-only `configuration` JSONB; draft → published → retired   |
| Run                      | `api.pipeline_runs`                | Pins version + parameters + input versions; digest idempotency   |
| Run log                  | `api.pipeline_run_logs`            | Append-only stage/error log per run                              |
| Run output               | `api.pipeline_run_outputs`         | Normalized provenance: which Dataset Version a run produced      |
| Schedule / event trigger | `api.pipeline_schedules`           | interval / daily / cron / catalogue events                       |

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
    "mode": "create", // or "append" / "none"
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
- **Each SQL step is one `SELECT`** (optionally with a
  leading `WITH`). Comments, semicolons, dollar-quoting, schema-qualified
  names, `pg_*`/`lo_*` functions and DDL/DML keywords are rejected.
- **Output columns** must match the output Schema's field slugs (stable,
  immutable within a Schema Version), or be mapped explicitly with
  `fieldMapping`. Every non-nullable field must be produced; extra columns
  are rejected rather than silently dropped. Multi-valued fields expose
  their first value in v1 transforms.

## Python, action and webhook configuration

`transform.language` is `sql`, `python` or `none`. An optional `steps` array
contains up to nine further `{ name, language, statement }` SQL/Python steps.
Each step receives the preceding result as `previous`: a table in SQL, or
`inputs["previous"]` in Python. Original input aliases remain available.
Names must be lowercase identifiers; `previous` is reserved for the preceding
result. Zero Dataset inputs are valid.

Python defines `transform(inputs, parameters)` and returns row dictionaries or a
pandas DataFrame. Any Python step requires `pythonRuntime` to contain the exact
`repository@sha256:...` runtime image. The editor discovers availability from
`GET /api/pipelines/runtime`; an unavailable or mismatched pin fails closed.
See the [Python runtime runbook](../operations/pipeline-python.md).

`output.mode: "none"` skips Dataset creation and snapshotting. The `actions`
array contains up to twenty `{ name, operation, arguments }` ELN actions. The
catalogue in `src/lib/pipelines/actions.ts` supplies labels, argument contracts
and fixed canonical RPC names. For example:

```json
{
  "name": "project",
  "operation": "create_project",
  "arguments": { "p_title": { "$ref": "parameters.study_name" } }
}
```

Explicit references preserve value types: `parameters.name`, `previous.0.value`,
`output.datasetId` and `actions.project.id`. Ordinary strings remain literal.
Unknown operations, editable server-owned arguments, unresolved references and
invalid values fail closed. Revision-bearing operations require the expected
revision rather than silently overwriting current state. The catalogue covers
project creation, model records, record properties/lifecycle/links, sample
custody, reagent movement and Dataset commit/snapshot/lifecycle. Review
confirmation, signatures and attestation are not autonomous actions.

`notifications` contains up to ten `{ subscriptionId, payload? }` entries. The
existing active webhook subscription owns its destination and signing secret.
The optional JSON payload supports the same references and is delivered as
`data`; omitting it sends only run/output metadata. Payloads are limited to
64 KiB. The envelope has `schemaVersion: "1"`, `eventType:
"pipeline.run.completed"`, stable `eventId`, workspace/run/version ids and
`result` metadata. It is inserted in the existing delivery outbox in the same
transaction as the ELN changes. The delivery engine supplies signing, retries,
rate limits and replay. Receivers must deduplicate by `X-Sheetbase-Event-Id`.

## Execution boundary (AUTO-02)

SQL steps run server-side (`src/lib/pipeline-execute.server.ts`) inside a
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
   a prior success replays for data-only requests. Deliberate UI invocations with ELN actions or webhooks carry a fresh `manual:<uuid>` identity, retained for network retries within that invocation. A concurrent duplicate conflicts (`SB044`), a
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
3. **Record** — succeeded runs carry named action results, queued webhook delivery
   ids, `rowCount`, optional output Dataset/Version ids
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
- **Schedule** — four kinds: `interval` (every N minutes), `daily` (HH:MM),
  `cron` (five fields: minute, hour, day of month, month, day of week; 0 and 7
  are Sunday; when both day fields are restricted either may match) and
  `event`. The form's weekday, weekly and monthly presets are stored as `cron`.
  Clock-time kinds run on an **explicit IANA time zone** (default UTC — never
  the server's zone), so 09:00 stays 09:00 across daylight-saving changes; the
  form starts on the person's own zone and previews the next three runs.
  Schedules run the **latest published version**. Evaluated by the server
  sweep (`pipeline-scheduler.server.ts`) every 60s; schedule rows are locked
  only for the start decision so a long run never blocks the next tick. The
  cron maths lives twice, in `src/lib/pipeline-cron.ts` and
  `api.pipeline_cron_next`, and `tests/db/pipeline-scheduling.test.ts` holds
  them to the same answers.
- **Input bindings** — `spec.inputs` says how each pipeline input picks its
  Dataset Version, per input:
  - `pinned` — one exact version, every run (what `inputVersions` always did;
    still read, and `inputs` wins where both name an input);
  - `latest` — the Dataset's newest version when the run starts;
  - `incremental` — as `latest`, but the run only happens when the Dataset has
    a version newer than the last one this trigger ran on. The watermark is
    `pipeline_schedules.input_watermarks`, moved when the run starts (a failed
    run is retried on the same inputs, not skipped). With several incremental
    inputs, a run happens when any has new data. Not offered on event triggers,
    which already run only on new data.
    The form defaults new triggers to `latest`: pinning is the opt-in.
- **Missed runs** — `spec.missedRunPolicy`: `run_once` (default; catch up with
  one run when a late sweep finds a tick overdue) or `skip` (a tick more than
  5 minutes late is dropped and the schedule carries on from now). For event
  triggers the same setting decides what resuming a paused trigger does with
  events that arrived meanwhile: process them, or ignore them. Pausing never
  builds a backlog of timed runs; a resumed timed trigger carries on from now.
  A new tick is also skipped while a run this trigger started earlier is still
  working.
- **Activity** — everything a trigger declines to do is written to
  `api.pipeline_schedule_activity` (`skipped_missed`, `skipped_unchanged`,
  `skipped_overlap`, `skipped_no_version`, `input_unresolved`, `start_failed`)
  and shown in the trigger's History beside the runs it started
  (`pipeline_runs.schedule_id`). A skip that repeats every tick updates one
  row and counts, rather than writing a row a minute.
- **Where runs go** — the sweep starts each run through
  `api.start_pipeline_run` and hands it to `deps.run`; that single seam is where
  a durable job queue plugs in.
- **Event** — catalogue event schedules fire when the platform sweep
  observes a matching `change_events` row (optionally filtered to one
  Dataset for `dataset.versioned`). Any stable record/dataset/sheet/review
  event can trigger (`dataset.versioned`, `record.created`, `review.decided`,
  … — see `PIPELINE_TRIGGER_EVENTS` in `src/lib/pipeline-schedule.ts`).
  A new event trigger starts at the workspace's current change sequence — it
  watches what happens from now on and does not replay history. Delivery is a
  polling approximation, but **at-least-once**: the cursor advances only with a durable disposition, failures are recorded in
  `api.pipeline_trigger_failures` and retried, and abandonment after the
  budget is explicit and visible. Trigger configuration stores the canonical
  catalogue name (wire aliases and the legacy `dataset_version_created`
  spelling are accepted at intake and normalized). Only `dataset.versioned`
  supplies an input version; other events fire with the schedule's
  configured inputs, and the other inputs follow their bindings (pinned, or
  the Dataset's latest version when the run starts). See the [event catalogue](../api/event-catalogue.md)
  for the full vocabulary.

## Incoming webhook triggers

The Triggers tab creates, rotates or disables a Definition-scoped bearer token.
Only its SHA-256 hash is stored in `internal.pipeline_webhook_triggers`; the new
secret is shown once and never stored in a published configuration.

Send `POST /api/pipelines/webhook/<definition-id>` with `Authorization: Bearer
<token>`, an `Idempotency-Key`, and JSON `{ "parameters": {}, "inputVersions": {} }`.
Requests are bounded to 64 KiB and rate-limited. The configuring user's current
pipeline-management and workspace-write permissions are checked on every call.
The first delivery pins the latest published version. The same key replays that
run, including after a new version is published; changed inputs with the same
key return a conflict. A failed run can be retried explicitly from Run history.

Session-authenticated GET reads settings; same-origin PUT rotates or disables
the token. No external API credential scopes are widened by this endpoint.

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

Identical manual requests replay the prior successful run. Definitions, inputs
and Python runtime identities are pinned; Python clock/randomness, current-state
ELN actions and external systems can still introduce non-determinism. Row order in the result is preserved from the transform's `ORDER
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

The executor uses a per-run advisory lock to prevent duplicate execution.
Database writes and outgoing deliveries roll back together on failure. Log
sequence values are monotonic allocation values and may contain gaps.
Cancellation records the terminal state immediately; in-flight analysis may
finish, but the next safe point rejects its output. A ten-minute database work
budget is checked between queries; the driver bounds an in-flight query.
