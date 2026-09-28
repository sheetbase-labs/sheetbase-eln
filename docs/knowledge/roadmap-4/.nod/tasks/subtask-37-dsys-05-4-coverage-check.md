---
id: subtask-37
title: DSYS-05.4 — Coverage check
type: subtask
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-09-28"
parent: task-33
tags:
  - DSYS-05.4
  - DSYS
---

# DSYS-05.4 — Coverage check

Step 4 of 4 in [DSYS-05](../../tasks/DSYS.md#dsys-05--design-data-seed); the full step text is under “Steps” there.

## Work Log
- 2026-09-28: PR #206: scripts/design-seed-coverage.mts (pnpm design:coverage) extracts ID-like values from every screen-text extract and reports those not present in the seeded database or the allowlist; current coverage 196/765.
- 2026-09-28: PR #206: coverage now splits stored families (EXP/SMP/PRT/MAT) from display ids with no stored column. Seedable id coverage reached 394/394; display-id families listed as a data-model gap (DS, PL, SHT, MDL, CAL, CL, …).
