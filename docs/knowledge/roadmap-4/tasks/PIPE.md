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

**Status:** proposed.

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

### Exit

A run summary reaches a configured Teams channel through the outbox with
retries, and delivery status is visible on the run.
