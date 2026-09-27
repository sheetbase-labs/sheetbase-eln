# PIPE — Pipelines with People in the Loop

**Status (2026-09-27):** Proposed; not assigned. Builds on the implemented engine; read [`../../handoffs/python-sql-pipelines.md`](../../handoffs/python-sql-pipelines.md) first and do not build a second engine.

## Programme goal

Pipelines automate analysis and ELN work, always show what is temporary and
what is kept, and stop to ask a person whenever a change to recorded data
needs judgement.

## Baseline at `main` `9538f36`

- Definitions, versions (draft, published, retired), runs (`running`,
  `succeeded`, `failed`, `cancelled`), logs and dataset outputs.
- SQL and Python analysis steps (Python in an isolated container, rows in and
  out), pinned input dataset versions materialised as temporary tables.
- Triggers: manual, schedules (`interval`, `daily`, `event` on
  `dataset.versioned`), incoming webhooks with one-time tokens.
- ELN actions from a fixed catalogue (`create_project`, `create_model_record`,
  `transfer_sample`, `consume_sample`, and others) that write directly through
  canonical RPCs after analysis; signed outbound notifications via webhooks.
- Runs execute in one transaction; actions cannot be interleaved with
  analysis steps (ADR-0042, ADR-0046).

## PIPE-01 — Pipeline screens

**Status:** proposed. **DEC-03:** absorbs the `/agent-operations` agent surface; the standalone route retires.

### Design

`canvas/PipelinesList.dc.html`, `PipelineEditor`, `PipelineTriggers`,
`PipelineRuns`, `PipelineRun`, `PipelineRunFailed`,
`design-system/components/Pipeline/README.md`.

### Scope

- List: tabs (mine, needs attention, scheduled, drafts), "starts on", last run,
  "keeps" column; inspector with recent runs and allowed/never-allowed actions.
- Editor: inputs with pinned snapshot and temporary table name; ordered step
  list (SQL, Python, ELN, Notify) with reads/returns; step editor with code
  view and "Test this step" preview on pinned inputs; step inspector (reads,
  writes, time limit, keep result); draft changes and compare with the
  published version.
- Triggers and outputs: manual, dataset snapshot (with debounce), schedule,
  incoming webhook; what a run keeps (nothing, snapshot of an existing
  dataset, new dataset); ELN actions table; notifications; service identity
  and permissions summary.
- Runs and versions; run detail with step timeline, step output preview
  (deleted after the run), log, inputs used, temporary data and when it was
  deleted, kept and did; failed run with likely cause and fixes.

### Start here

Read [`../../handoffs/python-sql-pipelines.md`](../../handoffs/python-sql-pipelines.md)
section 3 (source map) first. UI: `src/routes/pipelines.tsx`,
`src/routes/pipelines/$definitionId.tsx`, `src/routes/pipelines/runs/$runId.tsx`,
`src/components/pipelines/` (`pipeline-version-editor.tsx`,
`pipeline-actions-editor.tsx`, `pipeline-notifications-editor.tsx`,
`pipeline-run-history.tsx`, `pipeline-run-detail.tsx`, `pipeline-schedules.tsx`,
`pipeline-webhook-trigger.tsx`, `run-pipeline-dialog.tsx`); data
`src/lib/pipelines/data.ts`; tests `tests/db/pipelines.test.ts`.

### Steps (PRs)

1. List per `PipelinesList` (starts on, last run, keeps, inspector with allowed
   actions summary derived from the published configuration).
2. Editor per `PipelineEditor`: inputs with pinned version, step list, step
   editor with code view; **Test this step** calls a new server route that
   runs the pipeline up to that step on pinned inputs in a dry-run transaction
   that is always rolled back, returning the preview rows.
3. Triggers and outputs per `PipelineTriggers` (existing schedules, event and
   webhook trigger components restyled; "what a run keeps" radio).
4. Runs, run detail (step timeline with durations, output preview, temporary
   data list with deletion time, kept/did), failed run with cause
   (`PipelineRuns`, `PipelineRun`, `PipelineRunFailed`).

### Check it

`pnpm test src/components/pipelines src/lib/pipelines`, `pnpm test:db pipelines`;
dry-run test proves nothing persists; parity for the six boards.

### Exit

The screens match the design on the seeded pipelines; "keeps nothing" is the
default and is stated on every run.

## PIPE-02 — Waiting for a person

**Status:** proposed; after [DEC-08](DEC.md) (it changes the single-transaction run model).

### Design

`canvas/PipelineRunWaiting.dc.html`; inbox row in `canvas/HomeTriage.dc.html`.

### Scope

A "confirm" step kind that pauses a run in a new `waiting` status with a
typed decision form (for example units per column with suggestions and a
reason); named people asked through WORK-01 and email; confirm and continue,
skip the dependent steps, or stop; timeout with a defined outcome; temporary
data kept only while waiting (bounded); the decision is recorded under the
person's name in the affected record's History.

### Start here

`src/lib/pipeline-execute.server.ts` (`runPipelineExecution`, `executeSteps`,
work boundary `sb_pipeline_work`), run status check
`chk_pipeline_runs_status` in `schema.ts`, ADR-0046, DEC-08's ADR.

### Steps (PRs)

1. Migration adding `waiting` status and a `pipeline_run_prompts` table
   (run, step, form schema, asked users, answer, answered by, expires at).
2. Executor: a `confirm` step commits the work so far to temporary storage
   (bounded, per DEC-08), records the prompt and stops with `waiting`;
   answering resumes from the step with the same pinned inputs; skip and stop
   paths; expiry job.
3. Decision recorded under the person's name in the affected record's
   history; work item and email (WORK-01/03).
4. Waiting run UI per `PipelineRunWaiting`.

### Check it

DB tests: resume uses the pinned inputs; expiry cleans temporary data;
attribution is the person. Parity for `PipelineRunWaiting`.

### Exit

A run can pause and resume without losing its pinned inputs; the resumed
changes are attributed to the deciding person, not the service identity;
timeouts clean up temporary data.

## PIPE-03 — ELN actions as proposals

**Status:** proposed.

### Design

Proposal block in `canvas/Notebook.dc.html`; `canvas/PipelineRun.dc.html`;
`canvas/PipelineTriggers.dc.html` (ELN actions, "needs a person").

### Scope

An action mode where a pipeline proposes a change (for example a new figure
block after Figure 1) instead of writing it; the proposal appears in place with
Compare, Accept and Reject for the named person; acceptance applies it through
the canonical RPC as that person; proposals expire when superseded. Reuse the
agent-operation proposal model where it fits.

### Start here

Action catalogue `src/lib/pipelines/actions.ts`, execution
`src/lib/pipeline-actions.server.ts`; agent proposals
(`api.agent_operation_proposals`, `src/components/agent-operations/proposal-workbench.tsx`,
ADR-0043) as the model for accept/reject; notebook pipeline output blocks
(`src/components/notebook/pipeline-output-block-*.tsx`).

### Steps (PRs)

1. Action mode `propose` stored per action; executor writes a proposal
   (target record, block position, payload, run id) instead of calling the
   RPC.
2. Accept RPC applies the change through the canonical RPC as the accepting
   user; reject records reason; superseded proposals expire.
3. Proposal block in the notebook with Compare / Accept / Reject.

### Check it

DB tests: nothing changes before accept; accept is attributed to the person
with the run number.

### Exit

A proposing pipeline changes nothing in the notebook until a person accepts;
accept and reject are audited with the run number.

## PIPE-04 — File and figure outputs

**Status:** proposed.

### Design

`canvas/PipelineRun.dc.html` (figure output), `canvas/PipelineRunFailed.dc.html`
(storage and memory use).

### Scope

Python steps may return files (images, tables) as temporary artefacts with a
size limit; artefacts can feed an ELN proposal or be kept as files; per-step
resource usage (storage, memory) recorded and shown; storage-limit failures
reported with the measured usage.

### Start here

Python worker `docker/pipeline-python/worker.py`, broker
`scripts/pipeline-python-runner.mjs`, client `src/lib/pipeline-python.server.ts`,
`docs/operations/pipeline-python.md`.

### Steps (PRs)

1. Worker contract: functions may return files (bounded count and size) in a
   declared output directory; broker returns them with sizes.
2. Temporary artefact store per run (deleted at run end unless kept);
   proposals may reference them (PIPE-03).
3. Resource usage (peak storage, memory) captured by the broker and stored on
   the run; limit failures reported with numbers.

### Check it

`node scripts/test-pipeline-python-runner.mjs` and the container test pass
with a figure-returning fixture; artefacts deleted after the run.

### Exit

A figure produced by Python can be proposed into a notebook and is deleted at
run end unless kept; resource limits are enforced by the runner and reported.

## PIPE-05 — Notification channels

**Status:** proposed.

### Design

`canvas/PipelineTriggers.dc.html` (Teams, email), `canvas/SettingsIntegrations.dc.html`.

### Scope

Microsoft Teams (and email via WORK-03) as typed notification channels built on
the existing signed outbox, configured once per workspace; failure
notifications create inbox items for the owner.

### Start here

Outbox `src/lib/pipeline-notifications.server.ts`, transport
`src/lib/webhook-delivery.ts`, `webhook-http.server.ts`; notifications editor
`src/components/pipelines/pipeline-notifications-editor.tsx`.

### Steps (PRs)

1. Channel types: `teams` (incoming webhook URL configured once per workspace
   as a connector secret) and `email` (WORK-03 outbox); message templates.
2. Failure notifications create a work item for the owner.
3. Delivery status on the run page.

### Check it

Unit tests with a faked Teams endpoint; delivery status visible.

### Exit

A run summary reaches a configured Teams channel through the outbox with
retries, and delivery status is visible on the run.
