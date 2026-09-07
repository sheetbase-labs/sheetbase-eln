---
title: Python and SQL pipelines — implementation handoff and follow-on roadmap
status: implementation handoff; follow-on roadmap proposed
last_reviewed: 2026-09-08
implementation_ref: 4185c0245b0a499949f7a67674abc2456f7f88c1
---

# Python and SQL pipelines: handoff and roadmap

## 1. Start here

This document lets a new agent or junior developer continue the pipeline work without the original conversation. **The engine is already implemented. Do not start by building a second engine.** First reproduce the existing behaviour, create an inspectable demonstration in a disposable workspace, and then address the bounded work below.

The user's requirement is broader than transforming datasets: pipelines should automate work across the ELN, with SQL and Python analysis available when useful. Creating a project or moving a sample can be a complete pipeline. A dataset input or output is not compulsory. Incoming webhook triggers were explicitly requested as well as outbound notifications.

The implementation is on `GWP/design-overhaul`, in [Sheetbase PR #176](https://github.com/sheetbase-labs/sheetbase-eln/pull/176). This document describes commit `4185c0245b0a499949f7a67674abc2456f7f88c1`; the documentation commit that adds this file will be later. PR #176 also contains a broad interface overhaul. Keep subsequent pipeline work focused and do not revert those other changes.

At this handoff:

- Implementation and local checks exist; this is not a production acceptance claim.
- The PR was opened and CI started. Recheck its current status before relying on it.
- No production deployment or merge was performed.
- Python ran in isolated local containers during verification. Local services and image availability must be checked again; they are not permanent infrastructure.
- **No demonstration pipeline was run and retained in the app workspace.** Earlier runs were automated test fixtures. The local definition named `con` had no saved run when inspected. Do not describe the test evidence as a user-visible demo.
- The roadmap in section 11 is proposed follow-on work, not approval to deploy, merge, change live credentials or activate unrelated roadmaps.

Read these documents in order:

1. [Current work](../NEXT.md) and [knowledge index](../README.md).
2. [Agent workflows](../agent/workflows.md), [PRODUCT](../PRODUCT.md) and [DESIGN](../DESIGN.md).
3. [ADR-0046](../decisions/0046-python-and-eln-pipeline-actions.md), then [ADR-0042](../decisions/0042-deterministic-pipelines.md). ADR-0046 supersedes the SQL-only and mandatory-dataset restrictions, not the identity, permissions or provenance contracts.
4. [Pipeline subsystem contract](../../subsystems/pipelines.md).
5. [Python runtime runbook](../../operations/pipeline-python.md).
6. The source paths in section 3 and the relevant tests before editing.

For visible changes, also read the pinned `.agent/design/skills/product-design/SKILL.md`, `.agent/design/design.md` and Impeccable. Keep the registry compact, the editor work-focused and results inspectable. Preserve the root PRODUCT/DESIGN symlinks. The design submodule's supporting change is [design PR #1](https://github.com/sheetbase-labs/sheetbase-design/pull/1).

## 2. Vocabulary and mental model

| Term              | Meaning                                                                        | Common mistake                                                       |
| ----------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Definition        | Stable workspace object with a name and key                                    | Treating its editable name as identity                               |
| Version           | Configuration with a lifecycle: draft, published, retired                      | Changing a published version in place                                |
| Run               | One attempt with pinned version, inputs, parameters and actor                  | Treating the latest configuration as the configuration of an old run |
| Dataset Version   | Immutable input snapshot                                                       | Reading live dataset rows and calling the result reproducible        |
| Analysis step     | SQL SELECT or Python function returning rows                                   | Giving Python database credentials to perform actions                |
| ELN action        | Named invocation of an allowlisted canonical RPC                               | Running arbitrary SQL or arbitrary function names                    |
| RPC               | PostgreSQL function exposed through the canonical API                          | Creating a parallel privileged writer                                |
| RLS               | PostgreSQL row-level security                                                  | Assuming a hidden button enforces authorization                      |
| Expected revision | Version of the mutable object the caller expects to update                     | Silently overwriting a concurrent change                             |
| Occurrence        | Stable identity of a manual intent, scheduled tick, event or incoming delivery | Retrying with a fresh identity and repeating effects                 |
| Outbox            | Durable record of an outbound delivery to perform after commit                 | Equating queued with received                                        |
| Runtime pin       | Exact `repository@sha256:...` Python image                                     | Using a mutable tag such as `latest`                                 |

The current order is fixed:

```text
start run and pin identity
  → materialize input snapshots
  → first analysis transform + additional SQL/Python steps
  → optional dataset output and snapshot
  → ordered ELN actions
  → queue signed notifications
  → mark run succeeded and commit
  → webhook delivery engine sends queued notifications
```

The UI groups these concerns for authoring, but that does not imply arbitrary execution ordering. Actions currently run after analysis and dataset output. They cannot be interleaved with analysis steps. This is a sequential workflow, not a branching graph or general-purpose workflow language.

## 3. Source map: where to work

Paths in this table are relative to the repository root. Open them there; do not create similarly named replacements.

| Concern                    | Source                                                                                    | What to inspect first                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Configuration              | `src/lib/pipelines/config.ts`                                                             | `PipelineConfig`, validation, run-request validation and limits                |
| SQL statement restrictions | `src/lib/pipelines/statement.ts`                                                          | Accepted syntax and safe parameter substitution                                |
| Client wire contract       | `src/lib/pipelines/types.ts`, `data.ts`                                                   | Existing query keys and canonical RPC wrappers                                 |
| Executor                   | `src/lib/pipeline-execute.server.ts`                                                      | `runPipelineExecution`, `executeSteps`, output path, savepoint and catch paths |
| SQL/Python entry route     | `src/routes/api/pipelines/execute.ts`                                                     | HTTP handler delegation; start and execute are separate operations             |
| Python app client          | `src/lib/pipeline-python.server.ts`                                                       | Runtime discovery, bounds, HTTP failures and pin validation                    |
| Python broker              | `scripts/pipeline-python-runner.mjs`                                                      | Fixed container arguments, concurrency, authentication and cleanup             |
| Python worker              | `docker/pipeline-python/worker.py`                                                        | Input decoding, function invocation, output/log validation                     |
| Images/packages            | `docker/pipeline-python/`                                                                 | Worker and broker Dockerfiles, pinned Python requirements                      |
| Action catalogue           | `src/lib/pipelines/actions.ts`                                                            | Supported operations and editable argument schemas                             |
| Action execution           | `src/lib/pipeline-actions.server.ts`                                                      | Typed references, bound values, actor role and canonical RPC invocation        |
| Incoming webhook           | `src/lib/pipeline-webhook.server.ts`, `src/routes/api/pipelines/webhook.$definitionId.ts` | Token lifecycle, authorization, occurrence replay and request conflict         |
| Outbound queue             | `src/lib/pipeline-notifications.server.ts`                                                | Transactional delivery insertion and payload reference resolution              |
| Outbound transport         | `src/lib/webhook-delivery.ts`, `webhook-http.server.ts`                                   | Signing, retry/replay, destination validation and pinned DNS resolution        |
| Schedule/event execution   | `src/lib/pipeline-schedule.ts`, `pipeline-scheduler.server.ts`                            | Event catalogue, due ticks, crash recovery and abandonment                     |
| Definition registry        | `src/routes/pipelines.tsx`                                                                | Search, loading/error/empty states and child-route outlet                      |
| Definition workspace       | `src/routes/pipelines/$definitionId.tsx`                                                  | Build, Run history, Triggers and Versions tabs                                 |
| Authoring                  | `src/components/pipelines/pipeline-version-editor.tsx`                                    | Draft state, SQL/Python switching, validity and save flow                      |
| Action/notification forms  | `pipeline-actions-editor.tsx`, `pipeline-notifications-editor.tsx` in the same directory  | JSON drafts must survive invalid intermediate edits                            |
| Run/retry UI               | `run-pipeline-dialog.tsx`, `pipeline-run-history.tsx`, `pipeline-run-detail.tsx`          | Pinned retry values, invocation identity and result links                      |
| Run URL                    | `src/routes/pipelines/runs/$runId.tsx`                                                    | Persistent run detail, separate from definition identity                       |
| Trigger UI                 | `pipeline-schedules.tsx`, `pipeline-webhook-trigger.tsx`                                  | Configuration permissions and one-time token display                           |
| Runtime discovery route    | `src/routes/api/pipelines/runtime.ts`                                                     | Session-protected availability response; no broker secret                      |
| Shared editor layout       | `src/components/ui/form-section.tsx`                                                      | Label/content layout; reuse rather than copy classes                           |
| Agent Operations           | `src/routes/agent-operations.tsx`, `src/components/agent-operations/`                     | Workflow/proposal human review and separate policy tab                         |
| Deployment                 | `scripts/deploy.ts`, `src/lib/deployment-plan.ts`, `compose.pipeline-python.yaml`         | Optional image validation and private broker startup                           |
| Database schema            | `src/db/schema.ts`, `drizzle/`, `drizzle/meta/_journal.json`                              | Current schema plus full migration history, not just the newest SQL file       |

### New migrations in this branch

| Migration | Purpose                                                                        |
| --------- | ------------------------------------------------------------------------------ |
| 0165      | Project list summary, part of the wider PR; not the Python runtime             |
| 0166      | Python configuration extension and internal incoming webhook settings          |
| 0167      | ELN action/config validation, run log sequencing and cancellation locking      |
| 0168      | Schema constraints for webhook/manual occurrence identities without schedules  |
| 0169      | Start-run rules for deliberate manual invocations and stable occurrence inputs |

Use the full migration chain. Do not selectively apply only 0166 or paste SQL from a migration into an existing environment. Generate new migrations with `pnpm db:generate` / the repository's Drizzle custom-migration workflow as appropriate; keep snapshots and journal consistent. Do not rewrite a migration already applied by another environment to hide a defect.

## 4. Execution and security invariants

### Start and replay

The client starts a run through `start_pipeline_run`, then requests execution. The database owns run identity and conflict detection. It is not a digest supplied by a client.

- Data-only manual runs preserve same-input success replay.
- Deliberate manual runs with actions or notifications carry `manual:<uuid>`. The dialog retains that identity for network retries during the same invocation. A new deliberate invocation gets a new identity.
- A failed run is retried through an explicit linked attempt. Keep its original definition version, parameters, input versions, schedule and occurrence.
- Incoming webhook keys identify an occurrence and bind it to the first delivery's configuration/input choice. Publishing a later version must not change an old key's replay.
- Scheduled/event recovery uses the original crashed occurrence and pinned version, not the latest published version.
- An already-finished execution call is a no-op and returns the stored run. `ok: true` for replay does not mean a cancelled run became successful; inspect `run.status`.

### Database transaction

The executor establishes the run actor, obtains a transaction-scoped advisory lock for the run, and opens `sb_pipeline_work`. Input materialization, analysis, dataset writes, actions and notification queueing occur inside that work boundary. A later failure rolls back earlier database work before recording failure. Do not move an action outside this boundary merely to make a test pass.

SQL runs as `pipeline_worker`, with its search path restricted to temporary input/result tables and without application-table grants. After analysis, the executor restores the actor claims required by the governed writer path. Action names come from a fixed catalogue and arguments are bound values. Workspace/role checks and expected revisions remain enforced by the canonical operations.

The trusted connection, low-privilege SQL role, authenticated action role and Python container are different trust boundaries. Keep them distinct. Never forward a user-authored role, workspace, SQL function name or connection option into a privileged path.

### Cancellation, timing and logs

Cancellation can be recorded while analysis is running. It takes effect at a safe checkpoint; it is not a promise that the Python process stops the instant the user clicks Cancel. Output must not commit after cancellation wins. See the database concurrency test before changing row locks.

The executor has a ten-minute budget checked between database queries. SQL and Python also have their own per-step bounds. A between-query budget is not a hard wall-clock kill switch for every external operation.

Logs are useful evidence, but work-phase logs participate in the transaction/savepoint. Do not assume every intermediate log survives a rollback. Render Python output and error text as untrusted text. Do not print secrets or complete scientific inputs merely for debugging.

### Python boundary

Python receives row dictionaries and parameters over JSON, and returns rows. It receives no app credentials, Docker socket, host directories or network. Only the separate trusted broker controls Docker. The app must not mount the socket.

The broker accepts one installed immutable image, not a caller-selected command or runtime environment. A definition must pin that exact image. A mismatch is an error, not permission to use another image or run Python inside Node.

| Limit                          | Current contract                                                                        |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| Additional analysis steps      | Up to 9 after the first transform                                                       |
| Parameters / named inputs      | Up to 50 / 10                                                                           |
| Statement length               | Up to 20,000 characters                                                                 |
| ELN actions / notifications    | Up to 20 / 10                                                                           |
| Python row/cell bounds         | 100,000 rows, 256 fields per row, 1,000,000 cells; input totals span aliases            |
| Python request/result          | 32 MiB each                                                                             |
| Captured Python logs           | 64 KiB                                                                                  |
| Python container               | 1 CPU, 512 MiB, 64 processes, read-only root, non-root UID/GID 65532                    |
| Temporary filesystem           | 64 MiB, ephemeral and non-executable                                                    |
| Python execution / app request | 60 seconds / 90 seconds                                                                 |
| Broker concurrency             | 2 jobs; excess work is rejected rather than an unbounded queue                          |
| Incoming body / outbound data  | 64 KiB                                                                                  |
| Incoming rate limiter          | 120 requests per 60 seconds; inspect implementation before assuming a distributed quota |

Use the constants and tests as authority if these values change. Decimal and date strings stay strings until code deliberately converts them. Python DataFrames are supported; duplicate/non-string columns and non-finite values are rejected. Use `None` for intentional missing values. Reproducible inputs and a pinned image do not make randomness, clock access, mutable ELN state or external consumers mathematically deterministic.

## 5. Configuration recipes

These are configuration examples for understanding and testing the contract. **The current UI is a structured editor, not a full JSON import screen.** Enter their fields through Build, or use the existing typed data-client helpers when writing a fixture. Do not invent an undocumented import endpoint.

### A. Smallest SQL analysis with no dataset writes

```json
{
  "configVersion": 1,
  "parameters": [],
  "inputs": [],
  "transform": { "language": "sql", "statement": "SELECT 2 AS value" },
  "output": { "mode": "none", "datasetLabel": "Smoke test" }
}
```

Expected: success and `rowCount: 1`; no new dataset. Do not assume result rows are persisted as a generic preview: the run primarily stores result metadata, action results and optional dataset provenance. If the job needs lasting scientific data, configure a dataset output or a governed action.

### B. Python followed by SQL

Replace the entire runtime placeholder with the installed image reference returned by the runtime endpoint. The placeholder is intentionally not runnable.

```json
{
  "configVersion": 1,
  "pythonRuntime": "<installed-repository>@sha256:<64-character-image-digest>",
  "parameters": [],
  "inputs": [],
  "transform": {
    "language": "python",
    "statement": "def transform(inputs, parameters):\n    print('Created two example rows')\n    return [{'value': 2}, {'value': 4}]"
  },
  "steps": [
    {
      "name": "scaled",
      "language": "sql",
      "statement": "SELECT value * 10 AS scaled FROM previous"
    }
  ],
  "output": { "mode": "none", "datasetLabel": "Mixed language smoke test" }
}
```

Expected: both steps execute, two final rows are counted, Python log text/runtime identity are inspectable, and no dataset is created. Extend the fixture with a real schema and output when validating persisted values `20` and `40`; row count alone does not prove those values.

Original input aliases remain available across steps. SQL reads the preceding rows from `previous`; Python reads them from `inputs['previous']`. Do not name a user input `previous`. SQL supports a single allowed SELECT/CTE expression, not DDL/DML, arbitrary schema access or a sequence separated by semicolons.

### C. A pipeline whose result is an ELN project

```json
{
  "configVersion": 1,
  "parameters": [{ "name": "study_name", "type": "text", "required": true }],
  "inputs": [],
  "transform": { "language": "none", "statement": "" },
  "output": { "mode": "none", "datasetLabel": "Project automation" },
  "actions": [
    {
      "name": "project",
      "operation": "create_project",
      "arguments": { "p_title": { "$ref": "parameters.study_name" } }
    }
  ]
}
```

Supply a clearly marked demo title. Expected: one project in the run workspace, a named `project` action result and no dataset requirement. Inspect the actual returned shape before using `actions.project.id` in a later action. The database test also demonstrates project → experiment creation.

### References and action catalogue

A reference is an object such as `{ "$ref": "parameters.study_name" }`. A plain string remains a literal. Supported roots are `parameters`, `previous`, `output`, and preceding named `actions`. Values preserve their types; this is not arbitrary expression evaluation. Unknown/missing references fail rather than silently becoming empty strings.

Current operations:

| Area             | Operations                                                                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Projects/records | `create_project`, `create_model_record`, `update_record_custom_fields`, `archive_record`, `restore_record`, `create_record_link` |
| Samples          | `transfer_sample`, `receive_sample`, `consume_sample`, `edit_sample`, `archive_sample`, `restore_sample`                         |
| Reagents         | `record_reagent_movement`                                                                                                        |
| Datasets         | `commit_dataset_row_batch`, `snapshot_dataset`, `archive_dataset`, `restore_dataset`                                             |

Read `PIPELINE_ACTIONS` for exact argument names, types, nullable/required flags and server-owned values. A revision argument is usually mandatory for updates. `p_idempotency_key` on the dataset commit is generated by the server; do not add it as an editable argument. Never add signing, human review confirmation or attestation by fabricating a human session.

## 6. Local setup, step by step

### 6.1 Establish the checkout

```sh
git status --short
git branch --show-current
git submodule update --init .agent/design
node --version
pnpm --version
```

Use the repository's required Node/pnpm versions from root AGENTS.md/package.json. Preserve other work in the checkout. If the branch is no longer current, inspect PR #176 and its merge status before choosing a base. Do not reset the user's branch or discard changes.

Install dependencies with `pnpm install --frozen-lockfile` if needed. For a new local setup, copy `.env.example` to `.env.local` and fill the development values described by the repository. Do not overwrite an existing local environment file. Do not copy production secrets.

### 6.2 Start the app's local dependencies

```sh
pnpm services:up
pnpm db:migrate
pnpm dev
```

Migrations require the dedicated `MIGRATION_DATABASE_URL`, not an app writer connection. Run these against the intended local database only. Use the orb-specific setup instead when the environment is an orb; do not start a competing Docker database there. If a server already owns port 3000, inspect it and reuse it rather than starting another server.

Check `http://localhost:3000/api/health/ready` and sign into the local app using its established development flow. Auth-free demo mode is development-only. Do not enable it in production.

Avoid `db:fresh`, volume deletion and database resets when using existing demo data. The dedicated database test helper has its own destructive test-database lifecycle, described below.

### 6.3 Enable local Python

SQL/action-only use does not require the broker. For Python:

1. Confirm a functioning local Docker engine with `docker version`.
2. Inspect existing worker images. If the expected immutable image is present, reuse it. Otherwise build the worker using the commands and reviewed digest arguments in the [runtime runbook](../../operations/pipeline-python.md).
3. Confirm a `repository@sha256:...` reference exists. A local tag or bare image ID is not a valid replacement. Some build workflows do not produce RepoDigests; use an authorized registry/load workflow that supplies the required reference, not a fabricated digest.
4. Generate a separate random broker token of at least 32 characters. Keep it in a protected local secret file; never put it in a definition, screenshot, issue or committed shell script.
5. Start `node scripts/pipeline-python-runner.mjs` with a minimal environment containing PATH, `PIPELINE_PYTHON_IMAGE`, `PIPELINE_PYTHON_RUNNER_TOKEN`, `PIPELINE_PYTHON_RUNNER_HOST=127.0.0.1`, and an unused local `PIPELINE_PYTHON_RUNNER_PORT` (the previous run used 3003). Add trusted Docker endpoint variables only if the engine requires them. Do not source the complete app environment into this process.
6. Configure only `PIPELINE_PYTHON_RUNNER_URL=http://127.0.0.1:<port>` and the matching `PIPELINE_PYTHON_RUNNER_TOKEN` in the app's ignored local environment. Restart/reload the app if required.
7. In an authenticated browser, inspect `/api/pipelines/runtime`. It must report available with the installed digest. Verify a Python selection in Build discovers the same image. An unauthenticated or unavailable response is not success.
8. Run the real-container checks before using this as evidence for Python isolation.

Temporary files/process IDs from the earlier session are not part of this setup contract. Do not rely on them or print their secret contents. Keep the broker private; its Docker access is privileged even though the Python job is restricted.

## 7. Create the missing persistent demonstration

Use a disposable local workspace and clearly label demo objects. This exercise intentionally writes demo data; do not run it in production or against real scientific records.

1. Open Pipelines and choose **Create pipeline**. Give it a descriptive name such as `Demo: Python → SQL analysis` and a unique key.
2. Configure recipe B using the actual discovered Python image. Remove the default dataset input because the example creates its own rows.
3. Save the draft. Confirm the unsaved indicator clears. Publish the saved version; publishing must stay disabled while edits are unsaved.
4. In **Run history**, start the published version. Record the resulting run URL, version, runtime digest, status and logs. Do not substitute a screenshot of a mocked result.
5. For persisted result validation, configure an appropriate numeric schema/output in a new version. Run it and inspect the resulting Dataset Version values, not merely its row count. Record the dataset/version links.
6. Create recipe C as a separate `Demo: create project` definition. Publish and run with a clearly marked title. Verify the project is visible through the normal Projects page and that the run links/records its action result.
7. Repeat the same network invocation identity to prove replay does not create a second project; use a new deliberate invocation to prove intentionally repeating an action is possible. Compare IDs and row counts, not just toast messages.
8. Run a deliberately invalid Python example in a separate draft/version, then fix it through a new version. Use explicit retry only when reproducing the original failed attempt is intended. Do not mislabel running a fixed version as a retry of the old configuration.
9. Exercise cancellation during a long-running test step. Verify the cancelled status and absence of committed output. Do not assert instantaneous process interruption.
10. Leave the successful demo definition and run inspectable unless cleanup was requested. Record every created object and any cleanup performed.

Deliver an evidence table with definition URL, version, run URL, exact runtime pin, expected result, actual result, dataset/action links and date. This is the first roadmap exit and closes the gap that prompted the user's question about where the run was.

## 8. Webhooks and schedules

### Incoming

Open the definition's **Triggers** tab. Create a token using a permitted account, copy it once into the sending service's secret store and never save it in published JSON. Rotation invalidates the prior token; disable removes access. GET/PUT settings use session authentication; incoming POST uses the definition-scoped bearer token.

Protocol shape:

```http
POST /api/pipelines/webhook/<definition-id>
Authorization: Bearer <secret>
Idempotency-Key: <unique-key-for-this-logical-delivery>
Content-Type: application/json

{"parameters":{},"inputVersions":{}}
```

The configuring user's current membership and capabilities are checked on every call. Test a duplicate key, changed payload with the same key, rotation, disable and revoked permissions. A duplicate must remain attached to its original version after a later publication. Do not store an authorization header in test output. Read HTTP status and JSON together: asynchronous/running responses are not proof of successful completion.

### Outgoing

Create/manage the destination through the existing webhook administration surface. A pipeline notification selects an active subscription; it does not take an arbitrary URL or signing secret. Its optional payload supports references. The transaction queues the signed delivery; a separate engine sends it and provides retries/replay.

Use a controlled receiver only when sending is authorized. Verify receipt and signature separately from run success. Deduplicate on `X-Sheetbase-Event-Id`. A receiver outage must not cause the already-committed ELN actions to be rerun just to resend a message. Use delivery replay for that job.

### Scheduled and event runs

Use the existing interval/daily/event schedule UI. Daily schedules have an explicit IANA timezone. The sweep runs approximately every minute. Inspect `pipeline-scheduler.server.ts` and `PIPELINE_TRIGGER_EVENTS`; do not infer supported event names from prose or UI labels.

Test duplicate sweeps, start failure, stale execution recovery and publication between failure and retry. Event delivery is a polling approximation with durable retry/abandonment, not a claim of exactly-once external processing. Other than the dataset-version event's input binding, events use configured inputs; do not assume arbitrary event JSON is a new input dataset.

## 9. Validation and evidence

Run the smallest relevant layer first. For a docs-only change, validate links/examples/formatting rather than rerunning the app suite. For code changes, choose checks based on the contract changed, then run required repository checks before proposing merge.

```sh
# Configuration, SQL, action/reference, Python-client and incoming-trigger tests
pnpm exec vitest run src/lib/pipelines src/lib/pipeline-actions.server.test.ts src/lib/pipeline-python.server.test.ts src/lib/pipeline-webhook.server.test.ts src/lib/pipeline-schedule.test.ts src/lib/webhook-http.server.test.ts src/lib/webhook-delivery.test.ts

# Authoring, run/retry/result and review components
pnpm exec vitest run src/components/pipelines src/components/agent-operations

# Broker orchestration without real Python containers
node --test scripts/test-pipeline-python-runner.mjs

# Real containers: set this to an installed immutable image first
PIPELINE_PYTHON_TEST_IMAGE='<repository>@sha256:<digest>' node --test scripts/test-pipeline-python-container.mjs

# Database semantics; read the warning below first
pnpm exec vitest run --config vitest.db.config.ts tests/db/pipelines.test.ts

# Repository checks
pnpm typecheck
pnpm lint
pnpm build
git diff --check
```

The container tests **skip when the image variable is absent**. A green process with skipped tests does not establish isolation. The timeout test deliberately takes about a minute. Read the test summary and record pass/skip counts.

**Database tests drop and recreate `sheetbase_test`** using `tests/db/helpers.ts`, and apply the complete migration history. Confirm all configured URLs target the intended local cluster. Do not run DB suites concurrently against that shared test database. Never point this helper at a production cluster. It also needs the cluster roles described in the test helper/setup.

If pnpm wrappers have a local launcher problem, use the installed tools directly, for example `node node_modules/vitest/vitest.mjs ...` and `node node_modules/typescript/bin/tsc --noEmit`. A sandbox-denied database connection is an environment/access failure, not evidence to weaken a test. Retry only through the permitted local access path.

### Existing evidence at the implementation ref

| Layer                                 | Observed result                                                               | Limit of that evidence                                                              |
| ------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Production build / TypeScript         | Passed locally                                                                | Not deployment or CI acceptance                                                     |
| Full unit run                         | 3,540 passed; 5 initially failed                                              | Full suite was not rerun after corrections                                          |
| Targeted follow-up to those failures  | 32 passed after storage assertion fixes                                       | Grid/template failures did not reproduce in the targeted run                        |
| Pipeline database suite               | 35 passed                                                                     | Includes injected Python executor tests; not all are real-container end-to-end runs |
| Python client/broker/container checks | 21 passed in aggregate                                                        | Requires the local image/engine; repeat when changing isolation/runtime             |
| Pipeline and agent UI checks          | 24 passed                                                                     | Component tests, not proof of every browser workflow                                |
| Lint                                  | Three errors corrected and affected files rechecked; 38 warnings remained     | Do not call the earlier full lint invocation clean                                  |
| Browser design checks                 | Desktop and 390px; registry/search/dialog/tabs plus populated review fixtures | Populated agent review visuals were Storybook fixtures, not live operations         |
| Persistent app demo                   | Not done                                                                      | Must be completed in section 7                                                      |

Useful DB regression tests cover SQL output provenance, actor isolation, retries, duplicate starts/sweeps, event abandonment, stale-version recovery, mixed Python/SQL chaining, late failure rollback, action-only project/experiment creation, cancellation during Python, incoming replay and manual intent identity. Preserve those semantics rather than deleting assertions to make a new implementation pass.

## 10. Troubleshooting

| Symptom                               | Inspect                                                    | Next safe action                                                                                                 |
| ------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Python unavailable                    | App runtime route, app env presence, broker health/image   | Restore matching private configuration; do not fall back to in-process execution                                 |
| Pin mismatch                          | Saved version pin versus broker image                      | Restore the old image or deliberately create/publish a new version; never mutate the published pin               |
| Broker stops accepting jobs           | Cleanup failure and Docker health                          | Resolve/remove only identified disposable job containers, then restart broker; do not prune all Docker resources |
| Step times out                        | SQL/Python per-step bounds, data size, logs                | Minimize input and algorithm; raising limits requires resource/security tests                                    |
| NaN/infinity/column error             | Worker output conversion                                   | Make missing/non-finite handling explicit in scientific code; do not silently coerce to null                     |
| SQL rejected                          | Statement validator and supported syntax                   | Use a permitted SELECT over named inputs/previous, not a direct app-table query                                  |
| Start conflict                        | Running duplicate, prior failure, changed occurrence input | Inspect existing run; replay or explicit retry with the correct identity                                         |
| Action revision conflict              | Target's current revision and supplied expected revision   | Review the changed object; do not auto-rebase a consequential update                                             |
| Run succeeded but no webhook received | Delivery outbox/status and receiver logs                   | Diagnose/replay delivery independently of the run                                                                |
| Detail route displays registry        | Parent `/pipelines` outlet logic                           | Preserve child rendering; check generated route tree after route changes                                         |
| Save/publish lost JSON edits          | Action/notification draft state and validity callbacks     | Keep invalid text visible and block save until corrected                                                         |
| Tiny/clipped mobile review            | Workbench sizing and scroll containers                     | Check content width, long digests and wrapping; page-level overflow alone can miss internal clipping             |
| DB setup cannot connect               | Local service readiness, env target, sandbox permissions   | Fix access/setup first; never switch tests to a live database                                                    |

## 11. Follow-on roadmap

These are ordered, bounded work packages. The first two establish acceptance of current work. Later packages are proposals that require prioritization; they are not claims of existing capability. Do not start all packages at once. Each should be a reviewable PR or small sequence with its own evidence.

### P0 — Reconcile the branch and CI

**Depends on:** access to PR #176 and its source checkout.

1. Record current branch/SHA, PR state and check results. Confirm whether the design dependency is available and whether either PR has merged.
2. Read failing CI logs at the exact SHA. Reproduce relevant failures, separating environment setup from product defects.
3. Fix only demonstrated branch failures. Preserve full correctness coverage; do not skip failing tests or remove DB checks.
4. Update the evidence table and current-work link with the new ref and remaining limits.

**Acceptance:** every required check has an explained disposition; no false statement that local tests prove production readiness. Merge remains a separate authorized action.

### P1 — Retained end-to-end examples and regression coverage

**Depends on:** P0 checkout established; local runtime available.

1. Complete section 7 with the actual app, not mocked network responses.
2. Cover SQL-only, mixed Python→SQL, and action-only examples. For the mixed example, persist output and verify exact values.
3. Add a bounded browser workflow test using disposable fixtures and the canonical API helpers. Cover create → save → publish → run → inspect result. Isolate runtime-dependent tests explicitly rather than hiding skipped execution.
4. Add/reuse integration proofs for duplicate invocation, error rollback and cancellation. Distinguish real container tests from injected executor tests in output.
5. Write a small evidence record with stable app URLs and the fixture setup/cleanup procedure. Do not publish private data or secrets.

**Acceptance:** another developer can open a saved successful run, trace its input/configuration/runtime to its output, and reproduce the three examples. Failure and cancellation do not leave unintended records. This closes the current demonstration gap.

### P2 — Complete authoring and monitoring usability

**Depends on:** P1 so design is driven by real jobs.

1. Walk each example on desktop and phone with keyboard-only input. Note exact blockers before changing layout.
2. Make draft/published/run version distinctions and save/publish/run actions unambiguous. Preserve unsaved-edit guards and input text when validation fails.
3. Design typed argument controls from the existing action catalogue instead of requiring users to infer JSON shapes. Preserve an advanced JSON route where it is useful and validate at both client/server boundaries.
4. Show required revisions and reference sources clearly. Do not auto-fill a fresh revision and silently change the approved intent.
5. Improve run results around actual output kinds: datasets, created records/projects, stock/custody operations and queued deliveries. Keep raw diagnostic details secondary but available.
6. Decide whether a no-output analysis needs a bounded persisted preview. Treat preview persistence, data exposure and size limits as a contract decision; it does not exist merely because Python returned rows.
7. Update shared components/Storybook and add interaction tests for the changed paths.

**Acceptance:** a junior user can build and inspect the examples without memorizing RPC argument JSON; all actual output types have an understandable result; desktop/mobile, errors, empty state and keyboard focus are verified in a bounded visual pass.

### P3 — Runtime delivery and operational acceptance

**Depends on:** P0/P1; explicit authorization for image publication and environment changes.

1. Add a reviewed image build/publish workflow if none exists at implementation time. Pin base images, packages and output images. Record provenance and how to reproduce the worker/broker images.
2. Test isolation on the target Docker engine: non-root, no network/socket/secrets/host mounts, CPU/memory/process/time limits and cleanup failure behaviour.
3. Validate the optional overlay and application-to-broker runtime discovery in a disposable deployment first. Check token handling without printing values.
4. Exercise two concurrent jobs and excess demand. Document expected rejection/retry behaviour, memory budget and restart/cleanup recovery.
5. Decide runtime retention: the current broker serves one image. Publishing new runtime-pinned versions does not guarantee old pins remain runnable. Specify retention/routing before claiming multi-runtime support.
6. Obtain the required environment approval, deploy to development only, verify runtime identity and `/api/health/ready`, then run P1 examples there.
7. Prepare rollback and production activation instructions, including old-image availability and migration compatibility. Production activation is a separate approval.

**Acceptance:** images are retrievable by digest; target-engine isolation is proven; a development run completes; failures/rollback have an executable runbook; no Docker socket reaches the app/job and no public broker port is opened.

### P4 — Trigger and delivery acceptance under failures

**Depends on:** P1; controlled receiver authorization for external delivery tests.

1. Test incoming duplicate keys, changed bodies, publication between retries, invalid/rotated/disabled tokens and revoked configuring-user access.
2. Evaluate multiple app instances: the rate limiter is process-local unless changed, so document the actual enforcement boundary before promising a global quota.
3. Test schedule/event crash recovery with pinned old versions, duplicate sweeps and a failing start that reaches explicit abandonment.
4. Test outbound signature, event ID stability, receiver failure/recovery and replay. Inspect both run and delivery records.
5. Confirm operators can find trigger failures and queued/failed deliveries from the relevant UI without rerunning completed ELN work.

**Acceptance:** duplicate delivery does not duplicate committed effects; failed starts are not silently lost; retries preserve intended identity/version; outbound acknowledgement is reported separately from run success.

### P5 — Expand ELN actions from concrete requests

**Depends on:** one agreed user workflow and a verified canonical operation.

For each new action:

1. Describe the user outcome, object, permission and reversibility. Classify human-required steps first.
2. Inspect the canonical RPC, parameter types, null/default behaviour, return shape, RLS and revision contract.
3. Add one catalogue entry in `pipelines/actions.ts`; keep function names allowlisted and server-owned fields non-editable.
4. Update the database configuration validator with a new migration where required. Keep TypeScript and database validation aligned.
5. Add typed reference/argument tests, real database actor isolation, stale-revision rejection and late-action rollback tests.
6. Add authoring labels and meaningful result presentation. Document the new operation and one runnable example.

**Acceptance:** the action behaves like the same operation through the canonical app/API, including denial/conflict cases; no new privileged writer or forged human confirmation exists.

### P6 — Decide advanced workflow requirements before building

**Depends on:** evidence that P1–P5 cannot satisfy an agreed workflow.

Potential requirements include branches, loops, actions interleaved with analysis, human pause/resume, long jobs, distributed queues, arbitrary HTTP steps and package/runtime selection. They are **not implemented by the current ordered-step array**.

For each requested capability, write a small decision proposal covering state transitions, retries, cancellation, external effects, versioning, resource limits, permissions and observability. Assess reuse of Agent Operations for human-gated work instead of inventing a second approval system. Arbitrary HTTP requires an explicit network/secret/SSRF contract; do not grant networking to Python as a shortcut.

**Acceptance:** an approved contract and bounded implementation plan exist before engine changes. No speculative graph editor or general scripting platform is added merely to make the product appear complete.

## 12. How to hand off the next increment

Before ending a task, report:

- User outcome delivered and roadmap package completed.
- Branch, commit SHA, PR link and whether changes are merged/deployed.
- Source paths and migrations changed; any design-submodule dependency.
- Setup steps another developer actually needs, without secret values.
- Exact commands, pass/fail/skip counts, browser sizes and whether evidence used real services or mocks.
- Persistent definition/run/output URLs for demonstrations.
- Known limitations, decisions needing input, and the next bounded task.

Update [NEXT.md](../NEXT.md) only with current status and a link to this handoff. It remains the single cross-roadmap handoff; this file is the detailed pipeline continuation guide. Keep subsystem/runbook contracts authoritative and update them when behaviour changes rather than copying a second divergent specification here.
