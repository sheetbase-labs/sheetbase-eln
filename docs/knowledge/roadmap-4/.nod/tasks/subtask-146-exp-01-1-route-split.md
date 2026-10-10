---
id: subtask-146
title: EXP-01.1 — Route split
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: task-145
tags:
  - EXP-01.1
  - EXP
---

# EXP-01.1 — Route split

Step 1 of 4 in [EXP-01](../../tasks/EXP.md#exp-01--experiment-page-frame-and-tabs); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: /records/$recordId is now a layout; the notebook body moved unchanged into /records/$recordId/notebook, the bare record URL redirects to the notebook tab (search preserved) and /records/$recordId/overview stays a child. The notebook route tests pass. Status line and tab counts still follow with the tab routes (Samples, Datasets, Results, Files, History).
