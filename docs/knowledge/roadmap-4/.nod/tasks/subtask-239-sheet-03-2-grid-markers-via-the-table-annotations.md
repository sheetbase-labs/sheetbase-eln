---
id: subtask-239
title: SHEET-03.2 — Grid markers via the table annotations API; inspector thread
type: subtask
status: done
priority: medium
created: "2026-09-27"
updated: "2026-10-10"
parent: task-237
tags:
  - SHEET-03.2
  - SHEET
---

# SHEET-03.2 — Grid markers via the table annotations API; inspector thread

Step 2 of 2 in [SHEET-03](../../tasks/SHEET.md#sheet-03--sheet-cell-and-range-comments); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: verified against current code and closed; no new code needed. Grid markers go through the table annotations API in sheetbase-table-grid-client.tsx (props.annotations plus the incremental annotation handle), the inspector thread is the CommentPanel in canonical-sheet-workspace.tsx, the shortcut is registered as notebook-comment-selection (alt+mod+m) and wired in notebook-document.tsx to the comment action, and canonical search includes the live threads and replies. Component tests cover the markers (notes arriving after mount without remounting the engine), the selection membership (sorted, filtered and reordered), and the inspector thread.
