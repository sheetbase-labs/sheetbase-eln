# Roadmap 4 Tasks

Roadmap 4 contains **86 numbered tasks across 17 capability streams**. Each
stream file states the baseline, then each task's goal, design references,
scope, where to start in the code, PR-sized steps, how to check the work,
and exit. Read [`../GUIDE.md`](../GUIDE.md) first. Design references are paths under
[`../../design/ui-system-v3/`](../../design/ui-system-v3/README.md).

## Status — 2 October 2026 audit · current 28 of 85

**Active and incomplete.** [RECONCILIATION.md](../RECONCILIATION.md) audits all
86 original task definitions against the `9bbd305c` source. At that audit nod
recorded 17 done, 52 in progress, 16 todo and one cancelled duplicate
(SHELL-04 → DEC-03). Eleven tasks have closed since; the tracker now records
**28 of 85 active tasks and 87 of 266 steps done** (see
[CHECKLIST.md](../CHECKLIST.md) and the [update since the
audit](../RECONCILIATION.md#update-since-this-audit)). Four done tasks retain
historical implementation completion without fresh full acceptance.

The [checklist](../CHECKLIST.md) and [NEXT](../NEXT.md) are generated from nod.
Stream status lines summarize this dated audit; their baseline and original
scope notes retain planning context and do not describe current absence.

| Programme                | Stream / tasks             | Count | Notes                                                                   |
| ------------------------ | -------------------------- | ----: | ----------------------------------------------------------------------- |
| Decisions and foundation | [DEC-01..12](DEC.md)       |    12 | Scheduled first; every later dependency on a decision points here       |
| Decisions and foundation | [DSYS-01..06](DSYS.md)     |     6 | DSYS-01 delivered; DSYS-05 design seed and DSYS-06 parity suite         |
| Decisions and foundation | [SHELL-01..05](SHELL.md)   |     5 | SHELL-04 is DEC-03                                                      |
| Decisions and foundation | [COMP-01..07](COMP.md)     |     7 | Work in `sheetbase-components` and here; replaces Handsontable/Recharts |
| Daily work               | [WORK-01..04](WORK.md)     |     4 | WORK-01 unblocks Home, Inbox, phone and navigation counts               |
| Daily work               | [PROJ-01..04](PROJ.md)     |     4 |                                                                         |
| Daily work               | [EXP-01..06](EXP.md)       |     6 | EXP-05 after DEC-09                                                     |
| Daily work               | [SRCH-01..02](SRCH.md)     |     2 |                                                                         |
| Daily work               | [MOB-01..02](MOB.md)       |     2 | After WORK-01, LAB-01, LAB-05                                           |
| Scientific data          | [DSET-01..06](DSET.md)     |     6 | DSET-04 after DEC-11                                                    |
| Scientific data          | [SHEET-01..05](SHEET.md)   |     5 | On `sheetbase-table` and `sheetbase-explorer` (COMP-06/07)              |
| Scientific data          | [MDL-01..04](MDL.md)       |     4 | After DEC-07                                                            |
| Lab operations           | [LAB-01..07](LAB.md)       |     7 | LAB-04 after DEC-07; LAB-05 after DEC-10                                |
| Automation & platform    | [PIPE-01..05](PIPE.md)     |     5 | PIPE-02 after DEC-08                                                    |
| Automation & platform    | [SET-01..04](SET.md)       |     4 | SET-02 after DEC-05/06; SET-03 lockout after DEC-04                     |
| Governed evidence        | [REV-01..05](REV.md)       |     5 | REV-03/05 after DEC-04                                                  |
| Governed evidence        | [PORTAL-01..02](PORTAL.md) |     2 | After DEC-05                                                            |

Programme totals: Decisions and foundation 30, Daily work 18, Scientific data
15, Lab operations 7, Automation & platform 9, Governed evidence 7.

## Stream naming

Stream codes avoid names used by earlier roadmaps (Roadmap 2 `DATA`, `AUTO`;
Roadmap 3 `NAV`, `GRID`, `NOTE`, `FIND`, `MODEL`, `ADMIN`) so task IDs are
unique across the knowledge base.
