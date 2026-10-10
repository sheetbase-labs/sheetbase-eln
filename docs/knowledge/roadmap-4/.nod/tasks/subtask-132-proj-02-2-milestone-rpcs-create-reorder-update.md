---
id: subtask-132
title: PROJ-02.2 — Milestone RPCs (create, reorder, update, link evidence) with DB tests
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-130
tags:
  - PROJ-02.2
  - PROJ
---

# PROJ-02.2 — Milestone RPCs (create, reorder, update, link evidence) with DB tests

Step 2 of 3 in [PROJ-02](../../tasks/PROJ.md#proj-02--milestones); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (drizzle/0392; tests/db/milestone-rpcs.test.ts, 4 cases). api.create_study_deliverable appends at the next position within the owning task, api.update_study_deliverable changes name, description, status and target date, api.reorder_study_deliverables renumbers the task's milestones with the given order first and anything unlisted after, and api.link_study_deliverable_evidence sets the existing linked_record_id pair from the canonical record so the captured identifier cannot drift. All four require workspace write authority; reordering refuses an id belonging to another task. The tests cover create-and-order, reorder, update with a target date, evidence linking, and both refusals.
