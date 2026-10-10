---
id: subtask-40
title: DSYS-06.2 — tests/visual/parity.spec.ts that loops over design-states.ts
type: subtask
status: in-progress
priority: high
created: "2026-09-27"
updated: "2026-10-04"
parent: task-38
tags:
  - DSYS-06.2
  - DSYS
---

# DSYS-06.2 — tests/visual/parity.spec.ts that loops over design-states.ts

Step 2 of 3 in [DSYS-06](../../tasks/DSYS.md#dsys-06--visual-parity-suite); the full step text is under “Steps” there.

## Work Log
  - 2026-10-10: unblocked the design seed. pnpm db:seed:design was failing at the instruments step for every run: the dev database had drifted because earlier migrations were applied with psql -f, which bypasses the drizzle journal, so api.instruments was missing qualified_for (added by drizzle/0364) and internal.instrument_change_event raised 'record "new" has no field "qualified_for"' on every insert. Restoring the column makes the seed report all 44 steps applied idempotently. Lesson for this environment: apply migrations through pnpm db:migrate, not psql -f, or the dev database silently diverges from the journal. The materials fixtures were also aligned with the MaterialsList board (design titles, lots, per-lot stock, storage locations), which is the DSYS-05 seed work that the pending parity group needs.
  - 2026-10-10: MaterialsList mapped and measured, so it no longer sits in DESIGN_PENDING (tests/visual/design-states.ts). Its route, tabs (In stock 356 / Expiring 30 days 4 / Quarantine 3 / Expired 9) and columns already match; the remaining 0.02 (25349 px) diff is seeded content and is recorded as a diagnosed historicalMismatch under cause 3. The other 38 screens pending for the same reason are blocked on DSYS-05 seed coverage: the design screens show specific display IDs and per-record fields the design seed does not create yet, so that seed work unblocks the rest of the boards.
- 2026-09-27: PR #206: the parity suite now signs in as the screen's seeded design user (Better Auth session + __Secure- cookie) on a dedicated server with auth-free disabled; verified by rendering HelpRecords as Gareth P.
- 2026-09-27: PR #206: parity freezes the browser clock to the design seed clock (DESIGN_CLOCK) so date and relative-time copy matches the design render; verified HelpRecords still renders.
- 2026-10-02: 2026-10-02 reopened against current code: see DSYS-06 reconciliation note and RECONCILIATION.md#dsys-06. Implemented subsets retained; full step requirement is not met.
- 2026-10-04: 4 October: HelpRecords now genuinely passes unchanged .001 screenshot gate in both themes; its expected failures removed. Shared shell fidelity and global body minimum-width corrected. Integrated parity79passed includes70 remaining documented expected failures and72/252 mapped comparisons; DSYS-06 stays open. pnpm validate3550tests/337files, zero lint errors/18 unchanged warnings. Seven focused browser checks include axe, keyboard/route/Home selection and red-green390px document width.
