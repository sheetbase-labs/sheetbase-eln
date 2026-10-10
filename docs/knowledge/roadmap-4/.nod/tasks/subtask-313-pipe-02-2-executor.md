---
id: subtask-313
title: PIPE-02.2 — Executor
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-311
tags:
  - PIPE-02.2
  - PIPE
---

# PIPE-02.2 — Executor

Step 2 of 4 in [PIPE-02](../../tasks/PIPE.md#pipe-02--waiting-for-a-person); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator). A confirm step is an ordinary SQL/Python step annotated as needing a decision (form fields, asked users, skipSteps, noAnswer reask|apply|fail, expiresHours default 24 / max 168), so no migration was needed. The executor pauses at the first unanswered confirm step: it commits the work so far to a bounded pending snapshot, records the prompt, logs, and flips the run to waiting rather than succeeded or failed. resumePipelineRun answers through the canonical api.answer_pipeline_run_prompt RPC under the answering person's claims, re-materializes the run's pinned input_versions (never live data) and continues after the step, exposing the decision to dependent SQL/Python steps. Skip skips the configured steps; stop cancels without output. expirePipelinePrompts applies the per-step no-answer outcome under a row lock (reask stops and re-asks next time, apply resumes attributed to the pipeline, fail ends the run failed) and deletes temp data; the coordinator wired it into the scheduler's sweep tick. Eight new DB tests prove the pause, the pinned-input resume (two live rows added between pause and resume), skip, stop, a non-asked member refused, and the three expiry outcomes. Two limits recorded: the sweep is a timer-driven call with no dedicated unit test (the behaviour is covered at DB level), and metrics.ts has no waiting outcome label so a pause is not counted there.

