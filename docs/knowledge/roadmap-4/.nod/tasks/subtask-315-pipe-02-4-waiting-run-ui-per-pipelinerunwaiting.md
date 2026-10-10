---
id: subtask-315
title: PIPE-02.4 — Waiting run UI per PipelineRunWaiting
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-311
tags:
  - PIPE-02.4
  - PIPE
---

# PIPE-02.4 — Waiting run UI per PipelineRunWaiting

Step 4 of 4 in [PIPE-02](../../tasks/PIPE.md#pipe-02--waiting-for-a-person); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator). A waiting run reads as waiting: a warning banner, the prompt's typed form rendered from its schema (text/select, number, checkbox, date), a required reason, and Confirm and continue / Skip this step / Stop run. An answered prompt shows the decision, its values and who answered it, and a run with no prompt renders nothing fabricated; the run page gains an Asked/expiry inspector section. The answer posts to POST /api/pipelines/execute as { runId, answer: { decision, values?, reason? } } - the contract the executor worker agreed - and a non-2xx is surfaced inline. Eight tests cover the run page and the pipelines-data status mapping. Not built: the canvas's step timeline and the Temporary data / Why it asks inspector blocks, which have no source on this page (PIPE-01 scope).
