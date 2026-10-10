---
id: subtask-163
title: EXP-04.2 — Sheet block chrome
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-10-10"
parent: task-161
tags:
  - EXP-04.2
  - EXP
---

# EXP-04.2 — Sheet block chrome

Step 2 of 6 in [EXP-04](../../tasks/EXP.md#exp-04--notebook-working-surface); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: implemented (delegated, then verified by the coordinator). The grid's neutral contract gained a column group naming the column's source, a Source badge label, and an appendRow affordance; the engine client derives contiguous group runs from the displayed order and forwards the badge label and the new-run row, and the workspace supplies the values so a bound column names its Dataset plus the composed snapshot revision, a local column reads 'This experiment', and a calculated one reads 'Derived' and carries the fx mark. The new-run row appears only where a run can actually start. Data is threaded through the neutral contract rather than reaching into the engine client, and docs/development/sheetbase-table.md records the three props. 208 tests pass across 12 files. Not exercised: the real engine's DOM rendering of the group-header row, because the engine is mocked in unit tests.
