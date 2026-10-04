---
id: task-116
title: WORK-03 — Notifications and preferences
type: task
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-104
related:
  - task-2
tags:
  - WORK-03
  - WORK
  - wave-B
---

# WORK-03 — Notifications and preferences

Spec: [WORK-03 in tasks/WORK.md](../../tasks/WORK.md#work-03--notifications-and-preferences)

- Stream: WORK (epic-104)
- Wave: B
- Waits on: DEC-01 (task-2)
- Steps: 4 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: drizzle/0203_notifications.sql:28-61 — producer handles review request and signature creation only.; src/lib/email-delivery.server.ts — durable email worker implementation exists.; src/lib/email-scheduler.server.ts — scheduler exists.; src/components/v3/shell/app-shell.tsx:340-384 — current bell renders notifications.. Remaining: Complete all eight event producers/addressing and channel mapping; validate preferences, quiet hours, digest and durable delivery end-to-end. Existing outbox code is not proof all events route. See docs/knowledge/roadmap-4/RECONCILIATION.md#work-03. Source audit, not fresh service/browser acceptance.
