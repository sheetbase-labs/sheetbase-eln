---
id: subtask-131
title: PROJ-02.1 — Decide with the SHELL-04 outcome for /planner whether milestones reuse…
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-130
tags:
  - PROJ-02.1
  - PROJ
---

# PROJ-02.1 — Decide with the SHELL-04 outcome for /planner whether milestones reuse…

Step 1 of 3 in [PROJ-02](../../tasks/PROJ.md#proj-02--milestones); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: decided and written into the task. Milestones reuse api.study_deliverables: this task's scope says to reconcile with it rather than create a second planning model, and the model already carries name, description, status (planned/in_progress/delivered/overdue), a target date (due_at) and an evidence link (linked_record_id plus its captured identifier). It lacked ordering, which step 2 adds as a position scoped to the owning task. Milestones are task-scoped because task_id is NOT NULL, so a project's milestones are the deliverables of the tasks in its workstreams, which is what the project page renders. SHELL-04 is cancelled in favour of DEC-03, so there is no competing /planner outcome to reconcile against.
