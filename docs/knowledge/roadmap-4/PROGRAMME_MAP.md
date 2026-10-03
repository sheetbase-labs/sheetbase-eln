---
title: Roadmap 4 programme map
status: active — incomplete
last_reviewed: 2026-10-02
---

# Roadmap 4 programme map

Original dependency shape and waves, retained as planning context. Current
priority is in [NEXT.md](NEXT.md); [RECONCILIATION.md](RECONCILIATION.md) records
actual remaining work and the subset of hard dependencies added to nod.
All DEC decisions are recorded accepted. The delivery rules remain the original
contract; DSYS-06 must reconcile its test reference with the adopted app-3 port.

## Dependency shape

```text
DEC-01..12 decisions (scheduled first; each settles how, never whether)
      |
      v
DSYS-02 tokens ──▶ DSYS-03 primitives ──▶ DSYS-04 new components
      |                                          |
COMP-01 theme contract ──▶ COMP-02 table, COMP-03 charts, COMP-04 filters ──▶ COMP-05 releases
      |                                          |
      |          DEC-03/SHELL-04 ──▶ SHELL-01 shell ──▶ SHELL-02/03/05
      |                                          |
DSYS-05 design seed ──▶ DSYS-06 parity suite ────┤
                                                 v
      ┌──────────────── WORK-01 work items ─────────────────┐
      v                    v                    v            v
 WORK-02/03           PROJ-01..04     EXP-01..04, EXP-06    MOB-01
      |                                          |
      v                                          v
 DSET-01 value flags ──▶ DSET-02..03 ──▶ DSET-05 import ──▶ DSET-06 parsers
      |                                          |
      v                                          v
 LAB-01..03 samples ──▶ LAB-04 materials   COMP-06 grid swap ──▶ SHEET-01..04
 LAB-06 instruments ──▶ WORK-04 schedule   COMP-07 charts ──▶ SHEET-05
 LAB-07 protocols ──▶ EXP-02/03            MDL-01..04 ──▶ SHEET-02
 LAB-05 labels/scanning ──▶ MOB-02
 PIPE-01 ──▶ PIPE-02..05
 SRCH-01 ──▶ SRCH-02
 SET-01..04
 REV-01..05, EXP-05, PORTAL-01..02
```

## Suggested waves

| Wave | Goal                               | Tasks                                                                                                   |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| 0    | Decisions taken                    | DEC-01..12                                                                                              |
| A    | The product looks like v3          | DSYS-02..06, COMP-01..05, SHELL-01..05                                                                  |
| B    | Daily work, exactly as designed    | WORK-01..03, PROJ-01..04, EXP-01, EXP-04, EXP-06, SRCH-01..02, SET-01, SET-03, SET-04, COMP-06, COMP-07 |
| C    | Trustworthy data and evidence      | DSET-01..06, SHEET-01..05, REV-01..05, PIPE-01                                                          |
| D    | The physical lab                   | LAB-01..07, EXP-02, EXP-03, WORK-04, MOB-01..02                                                         |
| E    | Governance, automation and clients | MDL-01..04, PIPE-02..05, EXP-05, SET-02, PORTAL-01..02                                                  |

Wave 0 decisions are recorded complete; downstream capabilities remain open.
Waves overlap; the order within a wave follows the dependency shape.

## Delivery rules for this roadmap

- **Exactly v3.** A screen task is done only when its route passes the DSYS-06
  visual parity test against the design render, in light and dark, on the
  design seed. There is no list of accepted differences.
- **Fully working.** A screen ships with every capability it shows. A control
  that is missing or does nothing means the screen is not done; the screen and
  the capability tasks behind it land together or the screen waits.
- **Server-enforced.** Every rule a screen displays (permissions, locks,
  required fields, holds, approvals) is enforced by RPC/RLS with tests, not only
  in the UI.
- **Replace, don't coexist.** Each migrated route deletes the components and
  routes it supersedes in the same change.
- **Components at source.** Visual or behavioural gaps in grids, charts or
  filters are fixed in `sheetbase-components` and released, never patched over
  in the ELN.
- **Design first.** If a screen needs to differ from v3, the design is changed
  and re-vendored first; the parity suite then follows the new render.
- **Copy is part of parity.** Labels, empty states, errors and toasts use the
  design's wording.
- **Complete means all 126.** Roadmap 4 is complete when every design screen
  (plus any added under SHELL-04) passes parity and every control on it works.
