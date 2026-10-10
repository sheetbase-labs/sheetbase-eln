---
id: subtask-336
title: SET-02.3 — Access requests (from NbViewer)
type: subtask
status: done
priority: low
created: "2026-09-27"
updated: "2026-10-10"
parent: task-333
tags:
  - SET-02.3
  - SET
---

# SET-02.3 — Access requests (from NbViewer)

Step 3 of 4 in [SET-02](../../tasks/SET.md#set-02--members-roles-groups-and-project-access); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: completed. The request half already existed (EXP-04.5's viewer bar calls requestProjectEditAccess, with pending and refusal states tested), so the implementer's correction of the ticket's stale premise is recorded here. What was added is the audit: the access-request section now renders every request the reader may see with Person/Project/Reason/Decision, decided rows read 'Approved by <name> · <date>' using the decision attribution the list RPC omitted (the read now goes to the table, whose SELECT policy already scopes to managers or the requester's own row), and a pending request the reader cannot decide reads 'Waiting for approval' rather than appearing granted. Nine tests. Gap named and not closed: the viewer bar shows a static 'waiting for approval' after sending and never reflects a decided outcome inside the notebook - that needs a status read wired into NotebookViewerActions, and the outcome is visible today on /settings/access.
