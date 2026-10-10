---
id: subtask-327
title: PIPE-05.3 — Delivery status on the run page
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-324
tags:
  - PIPE-05.3
  - PIPE
---

# PIPE-05.3 — Delivery status on the run page

Step 3 of 3 in [PIPE-05](../../tasks/PIPE.md#pipe-05--notification-channels); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator). The run page gains a deliveries panel reading the real recorded state: the delivery ids the executor stores on the run result are read back from api.webhook_deliveries and joined to their subscription for the destination label. Each row shows destination, status (pending/retrying/delivered/failed/dead letter) and, for a failure, the reason; a run with no deliveries renders an honest empty state keyed to the run status rather than a blank panel. The panel also names what is not recorded yet - the channel type (Teams, email) is not stored per delivery - instead of guessing. Seven tests on the run page, 11 with pipelines-data. Not exercised: the deliveries queries against a live DB (read access is inferred from existing grants and RLS).
