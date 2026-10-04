---
id: task-324
title: PIPE-05 — Notification channels
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
  - PIPE-05
  - PIPE
  - wave-E
---

# PIPE-05 — Notification channels

Spec: [PIPE-05 in tasks/PIPE.md](../../tasks/PIPE.md#pipe-05--notification-channels)

- Stream: PIPE (epic-305)
- Wave: E
- Waits on: DEC-01 (task-2), PIPE-01 (task-306)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: src/lib/pipelines/config.ts:82 — notification targets are subscriptionId/payload only.; src/lib/pipeline-notifications.server.ts:32 — existing durable signed webhook deliveries, not typed Teams/email channels; line 88 writes notificationDeliveryIds into result.; src/routes/pipelines/$pipelineId/runs/$runId.tsx:103 — run UI renders Dataset outputs/logs, no notification-delivery status.. Remaining: All three steps: workspace Teams/email configuration and templates using existing outbox, owner work item on failure, delivery/retry status on run page. Existing signed-webhook support is baseline. See docs/knowledge/roadmap-4/RECONCILIATION.md#pipe-05. Source audit, not fresh service/browser acceptance.
- 2026-10-02: 2026-10-02 dependency reconciliation: added existing specification/programme-map gates PIPE-01. Other partial implementation can continue; these are full-task acceptance dependencies.
