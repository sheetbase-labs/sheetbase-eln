---
id: task-311
title: PIPE-02 — Waiting for a person
type: task
status: todo
priority: low
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-305
related:
  - task-2
  - task-9
  - task-306
tags:
  - PIPE-02
  - PIPE
  - wave-E
---

# PIPE-02 — Waiting for a person

Spec: [PIPE-02 in tasks/PIPE.md](../../tasks/PIPE.md#pipe-02--waiting-for-a-person)

- Stream: PIPE (epic-305)
- Wave: E
- Waits on: DEC-01 (task-2), DEC-08 (task-9), PIPE-01 (task-306)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: src/db/schema.ts:7770 — run status CHECK remains running/succeeded/failed/cancelled, no waiting.; src/lib/pipelines/config.ts:80 — steps permit only sql/python; no confirm step or pipeline_run_prompts table found in source/migrations.; docs/knowledge/roadmap-4/tasks/PIPE.md:116 — task requires durable prompts/resume/expiry and person attribution.. Remaining: All four steps: waiting schema, bounded persisted temporary state and resume/skip/stop/expiry, person-attributed history plus work/email notification, waiting UI. See docs/knowledge/roadmap-4/RECONCILIATION.md#pipe-02. Source audit, not fresh service/browser acceptance.
- 2026-10-02: 2026-10-02 dependency reconciliation: added existing specification/programme-map gates PIPE-01. Other partial implementation can continue; these are full-task acceptance dependencies.
