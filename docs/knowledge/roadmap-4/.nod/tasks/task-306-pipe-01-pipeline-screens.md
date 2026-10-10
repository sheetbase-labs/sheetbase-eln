---
id: task-306
title: PIPE-01 — Pipeline screens
type: task
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: epic-305
related:
  - task-2
tags:
  - PIPE-01
  - PIPE
  - wave-C
---

# PIPE-01 — Pipeline screens

Spec: [PIPE-01 in tasks/PIPE.md](../../tasks/PIPE.md#pipe-01--pipeline-screens)

- Stream: PIPE (epic-305)
- Wave: C
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-09-28: UI port (Plan A, branch roadmap-4/ui-app3): /pipelines board and /pipelines/$pipelineId with Overview, Runs and Triggers render the AUTO registry; Run now publishes and starts through the api RPCs and the same-origin execute route. The step editor with Test-this-step preview (PIPE-01.2), the full 'starts on'/'keeps' columns and webhook/event trigger editing remain.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/pipelines/$pipelineId/steps.tsx:17 — version editor saves a single transform/description/output; lines 166-184 render one SQL textarea, no per-step dry-run.; src/routes/pipelines/$pipelineId/runs/$runId.tsx:95 — real failure banner; lines 103-163 show retained Dataset snapshots and run logs.; src/lib/pipelines/config.ts:80 — SQL/Python ordered steps exist in engine; src/routes/api/pipelines/execute.ts:5 only executes an existing run, no test-this-step endpoint.. Remaining: 1 List/inspector needs acceptance against full starts-on/keeps/allowed-actions contract; 2 ordered SQL/Python/ELN/Notify editor, pinned preview inputs and rollback-only Test this step absent; 3 complete keeps selector and trigger/output/service identity summaries; 4 per-step durations/output preview/temp deletion timing and failed-run fixes. Existing pages are real, not complete task parity. See docs/knowledge/roadmap-4/RECONCILIATION.md#pipe-01. Source audit, not fresh service/browser acceptance.
- 2026-10-10: All steps done; closed by roadmap sync.
