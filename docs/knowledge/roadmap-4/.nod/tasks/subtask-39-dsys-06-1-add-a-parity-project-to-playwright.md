---
id: subtask-39
title: DSYS-06.1 — Add a parity project to playwright.config.ts with testDir
type: subtask
status: done
priority: high
created: "2026-09-27"
updated: "2026-09-27"
parent: task-38
tags:
  - DSYS-06.1
  - DSYS
---

# DSYS-06.1 — Add a parity project to playwright.config.ts with testDir

Step 1 of 3 in [DSYS-06](../../tasks/DSYS.md#dsys-06--visual-parity-suite); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: unblocked the design seed. pnpm db:seed:design was failing at the instruments step for every run: the dev database had drifted because earlier migrations were applied with psql -f, which bypasses the drizzle journal, so api.instruments was missing qualified_for (added by drizzle/0364) and internal.instrument_change_event raised 'record "new" has no field "qualified_for"' on every insert. Restoring the column makes the seed report all 44 steps applied idempotently. Lesson for this environment: apply migrations through pnpm db:migrate, not psql -f, or the dev database silently diverges from the journal. The materials fixtures were also aligned with the MaterialsList board (design titles, lots, per-lot stock, storage locations), which is the DSYS-05 seed work that the pending parity group needs.
