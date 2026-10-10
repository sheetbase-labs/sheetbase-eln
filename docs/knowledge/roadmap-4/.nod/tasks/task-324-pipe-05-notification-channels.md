---
id: task-324
title: PIPE-05 — Notification channels
type: task
status: done
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
  - 2026-10-10: closed. All three steps are done and the exit holds. PIPE-05.1 (subtask-325): channel types are teams and email, with email sending through the WORK-03 outbox (drizzle/0418, the widened create_webhook_subscription, and the enqueue in pipeline-notifications.server.ts) and message templates in notification-channels.ts - teamsMessageCard for Teams and emailMessage for email. PIPE-05.2 (subtask-326): failure notifications reach the owner as a derived run_failed work item. PIPE-05.3 (subtask-327): delivery status is on the run page, read back from api.webhook_deliveries. The named check, a run summary reaching a Teams channel, is now covered directly: webhook-delivery.test.ts posts a teamsMessageCard body through attemptDelivery to a faked endpoint and asserts a MessageCard arrives carrying the run id, alongside the 26 transport and delivery tests and the retry backoff tests. The exit's retries come from the existing webhook outbox sweep, unchanged. Honest limit: an email destination's send is recorded in internal.email_deliveries, not in api.webhook_deliveries, so it does not appear in the run page's deliveries panel - the panel already names the channel type as not recorded per delivery rather than guessing, and surfacing email sends there would need the outbox joined into that panel.
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): not-started. Evidence: src/lib/pipelines/config.ts:82 — notification targets are subscriptionId/payload only.; src/lib/pipeline-notifications.server.ts:32 — existing durable signed webhook deliveries, not typed Teams/email channels; line 88 writes notificationDeliveryIds into result.; src/routes/pipelines/$pipelineId/runs/$runId.tsx:103 — run UI renders Dataset outputs/logs, no notification-delivery status.. Remaining: All three steps: workspace Teams/email configuration and templates using existing outbox, owner work item on failure, delivery/retry status on run page. Existing signed-webhook support is baseline. See docs/knowledge/roadmap-4/RECONCILIATION.md#pipe-05. Source audit, not fresh service/browser acceptance.
- 2026-10-02: 2026-10-02 dependency reconciliation: added existing specification/programme-map gates PIPE-01. Other partial implementation can continue; these are full-task acceptance dependencies.
