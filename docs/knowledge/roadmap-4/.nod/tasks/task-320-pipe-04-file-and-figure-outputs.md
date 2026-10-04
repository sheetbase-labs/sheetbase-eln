---
id: task-320
title: PIPE-04 — File and figure outputs
type: task
status: todo
priority: low
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-305
related:
  - task-2
  - task-306
tags:
  - PIPE-04
  - PIPE
  - wave-E
---

# PIPE-04 — File and figure outputs

Spec: [PIPE-04 in tasks/PIPE.md](../../tasks/PIPE.md#pipe-04--file-and-figure-outputs)

- Stream: PIPE (epic-305)
- Wave: E
- Waits on: DEC-01 (task-2), PIPE-01 (task-306)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: docker/pipeline-python/worker.py:44 — transform must return rows; lines 55-65 reject non-list output and serialize only rows/logs.; scripts/pipeline-python-runner.mjs:104 — fixed Docker memory cap exists, but no declared file output contract/peak-resource result.; src/lib/pipelines/config.ts:48 — canonical retained outputs currently Dataset create/append/none.. Remaining: All three steps: bounded file-return worker/broker contract; per-run temporary artifact storage/keep/proposal cleanup; recorded peak storage/memory and measured limit failures. Reuse the current runner, not a second engine. See docs/knowledge/roadmap-4/RECONCILIATION.md#pipe-04. Source audit, not fresh service/browser acceptance.
- 2026-10-02: 2026-10-02 dependency reconciliation: added existing specification/programme-map gates PIPE-01. Other partial implementation can continue; these are full-task acceptance dependencies.
