---
id: subtask-360
title: REV-03.4 — Signing dialog per ReviewSign (focus in password field)
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-356
tags:
  - REV-03.4
  - REV
---

# REV-03.4 — Signing dialog per ReviewSign (focus in password field)

Step 4 of 4 in [REV-03](../../tasks/REV.md#rev-03--signing-with-password-re-entry-and-signature-certification); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator). The signing dialog is now a form, so Enter submits Sign while Cancel stays type=button; the summary matches ReviewSign (Signing as, Meaning, Revision, Content hash); initial focus remains in the password field, and Esc cancels with focus trapped by the modal. Five cases were added to the existing dialog test file without changing existing cases; 9 pass in that file.
