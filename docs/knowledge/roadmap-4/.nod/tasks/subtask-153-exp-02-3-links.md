---
id: subtask-153
title: EXP-02.3 — Links
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-150
tags:
  - EXP-02.3
  - EXP
---

# EXP-02.3 — Links

Step 3 of 4 in [EXP-02](../../tasks/EXP.md#exp-02--overview-plan-progress-and-readiness); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (drizzle/0395; tests/db/link-types.test.ts, 2 cases). The record_links link_type check now also admits follows and upstream, generated through drizzle-kit so the change is journaled. create_record_link needs no code change: it relies on the table constraint, and the target resolver matches an experiment by identifier (not UUID) with view access on the target. The notebook linked-record inspector's type picker offers both new types, so a link is expressible from the UI as well as the API. Setting the link on creation is EXP-03's step.
