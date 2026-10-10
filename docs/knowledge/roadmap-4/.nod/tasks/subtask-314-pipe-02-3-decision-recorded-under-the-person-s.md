---
id: subtask-314
title: PIPE-02.3 — Decision recorded under the person's name in the affected record's history
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-311
tags:
  - PIPE-02.3
  - PIPE
---

# PIPE-02.3 — Decision recorded under the person's name in the affected record's history

Step 3 of 4 in [PIPE-02](../../tasks/PIPE.md#pipe-02--waiting-for-a-person); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented as part of the executor work (PIPE-02.2) and verified. The decision is recorded through api.answer_pipeline_run_prompt, which writes the answer with the answering person's id and time and emits a change event on the run carrying the answerer, so the history shows who decided. The work item side was already added (run_waiting in api.my_work_items). Not done: the email half, which belongs to WORK-01/03's notification channels (PIPE-05).

