---
id: subtask-290
title: LAB-05.3 — /r/<identifier> resolver route to the right record page
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-287
tags:
  - LAB-05.3
  - LAB
---

# LAB-05.3 — /r/<identifier> resolver route to the right record page

Step 3 of 4 in [LAB-05](../../tasks/LAB.md#lab-05--labels-and-scanning); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented. src/lib/record-resolver.ts resolves an identifier to its record (trimmed, workspace-scoped by RLS, deterministic order) and src/routes/r/$identifier.tsx serves the printed label's QR target: it resolves and continues to the record's page with replace, and says 'Nothing matches this code' when the identifier names nothing rather than redirecting somewhere plausible. Verified in the running app: /r/SMP-LAB053-CHECK redirected to /records/<id>/notebook, and an identifier from another workspace (RPT-2026-0003, visible only to process-development) honestly reported no match in the fixture workspace, which is the workspace scoping working. src/lib/record-resolver.test.ts covers resolve, trim, miss and the empty code.
