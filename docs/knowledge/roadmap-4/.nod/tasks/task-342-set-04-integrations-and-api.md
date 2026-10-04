---
id: task-342
title: SET-04 — Integrations and API
type: task
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-02"
parent: epic-328
related:
  - task-2
tags:
  - SET-04
  - SET
  - wave-B
---

# SET-04 — Integrations and API

Spec: [SET-04 in tasks/SET.md](../../tasks/SET.md#set-04--integrations-and-api)

- Stream: SET (epic-328)
- Wave: B
- Waits on: DEC-01 (task-2)
- Steps: 3 subtasks

## Work Log
- 2026-10-02: 2026-10-02 reconciliation at ELN 9bbd305c (components 6f12e0b3): partial. Evidence: src/routes/settings/integrations.tsx:38 — real connector list/register flow; src/routes/settings/integrations/$connectorId.tsx:55 pauses/resumes connector and displays existing ingestion/run history.; src/lib/api-credentials.ts:147 — credential expiry may be null and only rejects past dates; no 90-day maximum.; src/components/v3/settings/settings-api-tokens.tsx:216 — no expiry displayed as Never; no refusal/unused/replacement workflow found.; src/routes/settings/integrations/$connectorId.tsx:8 — connector credentials/source/ingestion/run-history components, not webhook delivery history/retry/expiry UI.. Remaining: 1 Settings moves mostly landed and former admin/integrations route files removed; document remaining admin disposition/redirect decision. 2 Enforce 90-day max and token last-4/unused/refusal/replacement behavior. 3 Complete requested service-identity connect and delivery retry/pause/expiry-to-Inbox flow; connector pause is not webhook delivery control. Reopen SET-04.3 because checklist label omits its task-step delivery requirement. See docs/knowledge/roadmap-4/RECONCILIATION.md#set-04. Source audit, not fresh service/browser acceptance.
