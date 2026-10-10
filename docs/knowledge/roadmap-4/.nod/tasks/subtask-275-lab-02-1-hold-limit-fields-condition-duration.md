---
id: subtask-275
title: LAB-02.1 — Hold limit fields (condition, duration from harvest) on samples
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-03"
parent: task-274
tags:
  - LAB-02.1
  - LAB
---

# LAB-02.1 — Hold limit fields (condition, duration from harvest) on samples

Step 1 of 3 in [LAB-02](../../tasks/LAB.md#lab-02--hold-time-quarantine-and-release); the full step text is under “Steps” there.

## Work Log
- 2026-10-03: Hold fields (holdCondition, holdStartedAt, holdDurationDays, holdUntil, allowedUseExperimentIds) as validated record properties with one deadline rule; api.sweep_sample_hold_limits moves past-limit samples to hold_exceeded as System with a sample_event + record change event, scheduled from src/start.ts guarded like the other schedulers; consume_sample refuses a held sample unless the experiment is in the allowed-use list. Evidence: migration 0281 (applied to dev DB), tests/db/sample-hold.test.ts (7), sample-hold.server.test.ts, full pnpm test:db 146/1194, pnpm test 3315, interactions/areas/screens green, db:generate clean. Commit c2085dd0.
