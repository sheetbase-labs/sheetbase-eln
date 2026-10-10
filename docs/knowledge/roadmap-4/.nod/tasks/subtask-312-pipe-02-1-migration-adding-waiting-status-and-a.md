---
id: subtask-312
title: PIPE-02.1 — Migration adding waiting status and a pipeline_run_prompts table
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-311
tags:
  - PIPE-02.1
  - PIPE
---

# PIPE-02.1 — Migration adding waiting status and a pipeline_run_prompts table

Step 1 of 4 in [PIPE-02](../../tasks/PIPE.md#pipe-02--waiting-for-a-person); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (drizzle/0396; tests/db/pipeline-waiting.test.ts, 3 cases). api.pipeline_runs gains 'waiting' in its status check and a pipeline_run_prompts table records one paused step per run: the step id, the author's typed form schema, the asked users, and - once answered - the answer, its author and its time, with an expires_at for the no-answer behaviour. The answer is all-or-nothing: a check refuses an answer without a named person and time, so a prompt cannot look answered anonymously. The table is readable by the owning workspace (api.storage_member_using) and writable only by the executor, mirroring pipeline_run_logs. The executor, the resume/skip/stop paths and the waiting-run UI are steps 2-4.
