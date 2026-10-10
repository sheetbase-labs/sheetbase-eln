---
id: subtask-166
title: EXP-04.5 — View-only mode (NbViewer)
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-161
tags:
  - EXP-04.5
  - EXP
---

# EXP-04.5 — View-only mode (NbViewer)

Step 5 of 6 in [EXP-04](../../tasks/EXP.md#exp-04--notebook-working-surface); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then wired and verified by the coordinator). A read-only notebook now carries the design's viewer actions: request edit access through the existing request_project_edit_access RPC with honest pending and refusal states, copy the reader's selection to the clipboard, and comment on the selected block. A signed (locked) record renders read-only with the signatures table, sharing the route's signatures query so it is not fetched twice; the amendment entry point remains the route's locked banner, where the design puts it. The coordinator then made view-only actually reachable: NotebookCanvas takes viewOnly and the route derives it from hasCapability(role, 'record.create'), so a workspace viewer is never handed the editable path for the server to refuse. Six tests cover the viewer actions and a route test proves a viewer gets no add-block control on a record that is neither archived nor locked. Limits: project-level view-only access (a workspace writer with can_view but not can_edit) needs a project-permissions query the route does not currently run, and the inline signatures under a historical canvas are honest but untested.
