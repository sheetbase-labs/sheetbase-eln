---
id: subtask-301
title: LAB-07.3 — Training
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-09"
parent: task-298
tags:
  - LAB-07.3
  - LAB
---

# LAB-07.3 — Training

Step 3 of 6 in [LAB-07](../../tasks/LAB.md#lab-07--controlled-protocols); the full step text is under “Steps” there.

## Work Log
  - 2026-10-09: reminders are implemented (drizzle/0358; tests/db/protocol-training-reminders.test.ts, 3 cases): internal.notify_protocol_training raises one notification per untrained member, from the release event for already-pinned projects and from the project_protocols pin trigger, idempotent per member/version/project and excluding the actor and client viewers. Step 3 now holds end to end (acknowledgements, start enforcement, reminders).
  - 2026-10-09: acknowledgement and start enforcement are done (drizzle/0328/0351; tests/db/controlled-protocols.test.ts, tests/db/experiment-start-lifecycle.test.ts), but the step also requires reminders and none exist yet (no protocol reminder path in drizzle or src). Kept open.
  - 2026-10-09: training is enforced at start (drizzle/0351; tests/db/experiment-start-lifecycle.test.ts). api.start_experiment refuses an unacknowledged exact version, an ineligible version and a version the project is not pinned to, and records the version the experiment started on.
