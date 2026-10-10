# Dependable automation

Planned at `e5801327`, 2 October 2026. Read [GUIDE.md](../GUIDE.md), ADR-0046 and ADR-0052, `docs/subsystems/pipelines.md`, `docs/operations/pipeline-python.md` and the existing Python/SQL handoff. There is one Pipeline definition/version/run model and one canonical writer for each ELN action.

Current code supports pinned input versions and runtimes. The new steps editor exposes a narrower configuration, so authoring, safe preview and human-wait behavior must be reconciled with original PIPE tasks before these tasks depend on them. This is high-confidence source evidence, not a claim that the live runner is operational.

## R5-RUN-01: retain real SQL, Python and action workflow examples

**Outcome:** a developer or scientist can open persisted examples and inspect their exact inputs, runtime, execution, output and failures. Priority P1, effort M, medium risk. Depends on BASE-02, usable existing authoring, and an available reviewed Python runtime.

**Current state and scope:** `src/lib/pipeline-execute.server.ts`, `src/lib/pipeline-python.server.ts`, `src/lib/pipelines/data.ts` and `tests/db/pipelines.test.ts` contain the execution foundation. The earlier handoff requests persistent app demonstrations; this survey did not establish their current existence. Scope: fixture creation, actual runtime execution, browser inspection, scoped regressions and evidence. Reuse any current retained examples rather than creating duplicates.

**Steps:** persist one SQL-only case, one Python-to-SQL case and one action-only case using canonical APIs in a disposable acceptance workspace; record input/definition/output IDs and the immutable runtime digest; exercise publish → run → result inspection; demonstrate late failure, duplicate trigger, cancellation and retry behavior. Distinguish run success from remote webhook acknowledgement.

**Verification/exit:** run `tests/db/pipelines.test.ts`, `node --test scripts/test-pipeline-python-runner.mjs`, real-image container tests from GUIDE and a new `tests/browser/pipeline-execution.spec.ts`. Exact values agree with fixture expectations; repeat delivery creates no duplicate business result; real container/isolation cases have zero skips. No production broker deployment, new engine or fabricated human approval.

## R5-RUN-02: validate method changes against named scientific cases

**Outcome:** an author sees whether a candidate Pipeline version changes known results before using it for routine work. Priority P2, effort L, high risk. Depends on RUN-01 and PIPE-01's safe preview contract.

**Current state and scope:** `src/lib/pipelines/data.ts:117` accepts input-version and parameter bindings; immutable definitions/runtimes provide reproducible identity. R4 PIPE-01 already owns rich authoring and test-step preview. Scope: saved validation cases, explicit expected outputs/tolerances, fresh candidate execution and comparison with a baseline. Cases refer to existing Dataset Versions and Pipeline configuration; no second execution engine.

**Steps:**

1. Define validation identity: candidate content/version, inputs, parameters, runtime and expected-output rules. Distinguish a new validation attempt from idempotent replay of an old run.
2. Implement an execution mode that cannot commit ELN actions, notify humans or enqueue outbound deliveries. Fail closed for unsupported action/confirmation steps until their simulation contract is defined. A transaction rollback alone is insufficient proof for external effects.
3. Show row/field differences, missing/extra rows, tolerances and pass/fail without implying mathematical determinism for arbitrary Python. Retain the tested configuration and results.

**Verification/exit:** add `tests/db/pipeline-validation-cases.test.ts`, pure diff tests and a browser candidate-validation case. Run focused suites, the real Python tests and `pnpm validate`. SQL and pinned Python cases demonstrate equal, intended-change and failing-tolerance outcomes; no business records, outbox deliveries or signatures change. A changed candidate invalidates earlier approval evidence.

## R5-RUN-03: promote tested versions and manage runtime availability

**Outcome:** a maintainer chooses the tested version used for future runs and can return to a previous available version without changing historical runs. Priority P2, effort L, high risk. Depends on RUN-02.

**Current state and scope:** current draft/publish operations and schedules already select Pipeline versions; ADR-0046 requires exact Python image pins. Scope: existing publish/schedule controls, validation evidence, runtime readiness, explicit adoption/rollback and retirement checks. Inspect the existing publication selection semantics before deciding whether any additional pointer is needed.

**Steps:** define what binds a successful validation to promotion, including candidate/input/runtime digest; show the exact future-run impact; reuse existing publication/schedule authority for deliberate promotion and return to a prior version; surface unavailable runtime pins before execution; refuse runtime retirement while retained reproducibility needs it, or document the archive/reconstruction alternative.

**Verification/exit:** extend Pipeline DB/config/schedule tests and RUN-01's browser path; run those, actual runtime checks and `pnpm validate`. New runs follow the selected version, in-flight/historical runs keep their pins, stale promotion fails, and rollback creates neither duplicate actions nor altered prior evidence. Do not silently change published image pins, install packages dynamically in jobs, add Docker access to the app, or deploy a broker as part of code acceptance.
