---
title: Sheetbase Current Work
status: canonical
last_reviewed: 2026-10-20
---

# Sheetbase — Current Work

**Every Roadmap 4 active task is complete; nothing is in progress.** The work is
merged to `main` as `10a84a42` (PR #220, 11 October 2026); the branch was
`GWP/roadmap-4-shell`. Its [reconciliation](roadmap-4/RECONCILIATION.md) covers
all 86 original tasks and its evidence and limits still stand: task completion is
not release acceptance, and the visual and browser layers are deferred to
acceptance by the owner's instruction. The [Roadmap 4 handoff](roadmap-4/NEXT.md)
and nod tracker own its queue.

**Smooth-journeys work (19–20 October 2026).** After Roadmap 4, PRs #235–#244
worked through the cross-page user-journey audit (158 journeys): one experiment
frame, the Inbox as a work queue, bench and lab flows, dataset snapshots as
analysis sources, compare across datasets, qualification requests, the
conclusion block and server-side search. CORE-01..14 run as Playwright specs in
`tests/browser/journeys/`. The October journey map predates that work, so
re-check a journey against the current screens before treating it as open.
This is source and local-test evidence, not release acceptance.

[Roadmap 5](roadmap-5/README.md) is the proposed follow-on corpus — app-3
interface closure, 21 tasks over six streams, audited at `10a84a42`. It is not
activated and keeps no queue of its own. The separate, unnumbered
[complete scientific workflows](../../plans/roadmap-5/README.md) proposal covers
scientific depth and no longer owns the Roadmap 5 number.

This is a local source and documentation assessment. It does not establish
merge, current hosted CI, deployment or production acceptance. Earlier branch
and PR #176 status belongs to the [pipeline handoff](handoffs/python-sql-pipelines.md),
not the current-checkout summary.

## Programme status

| Programme | Current interpretation                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Roadmap 1 | Recorded complete; historical Core exits not independently recertified here.                                                                                                                                                                                                                                                                                                                                                                                                      |
| Roadmap 2 | Active scope recorded closed; GOV-02 remains deferred.                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Roadmap 3 | September reconciliation records 50 merged implementation tasks plus institutional proposals/deferrals; known limits and workflow acceptance remain. ADR-0045 was subsequently accepted through DEC-04; ADR-0044 remains proposed.                                                                                                                                                                                                                                                |
| Roadmap 4 | All 85 active tasks done on `GWP/roadmap-4-shell` (SHELL-04 cancelled in favour of DEC-03). The 2 October audit baseline it grew from was 13 accepted decisions, four inherited completions with acceptance unverified, 52 partial, 16 not started and one superseded duplicate; each was reconciled against the current source rather than the audit text. Completion is task-level: it is not release acceptance, and the deferred visual and browser layers remain unverified. |
| Roadmap 5 | Proposed follow-on corpus: app-3 interface closure (21 tasks, six streams), audited at `10a84a42` on 11 October 2026. Not activated; no queue of its own. Unfinished Roadmap 4 requirements retain their original task owner, and the unnumbered complete-scientific-workflows proposal is a separate programme.                                                                                                                                                                  |

The [7 September reconciliation](history/2026-09-07-roadmap-reconciliation.md)
remains historical evidence for Roadmaps 1–3. This update audits Roadmap 4;
it does not re-run all earlier programme exits. Recorded completion, source
implementation, independent acceptance and deployment are different claims.

## Next work (2 October audit ordering)

1. Restore the Roadmap 4 acceptance gate and shell behavior: DSYS-05/06 and
   SHELL-01/03. The original parity registry has zero mapped screen states;
   reconcile its reference contract with the adopted app-3 port before closing it.
2. Close scientific correctness and daily-work gaps: DSET-01 and MOB-02.
   LAB-07 owns effective protocol/training enforcement needed by EXP-02/03.
3. Complete COMP/SHEET/MDL dependencies and governed/operational workflows
   under their original IDs. Read the [task-by-task register](roadmap-4/RECONCILIATION.md#task-register)
   for exact implemented subsets, gaps and evidence.
4. Use the [Roadmap 5 corpus](roadmap-5/README.md) only for explicitly selected
   follow-on work. It does not supersede the remaining Roadmap 4 acceptance
   gaps, authorize implementation or certify release readiness, and it keeps no
   queue of its own. The unnumbered
   [complete scientific workflows](../../plans/roadmap-5/README.md) proposal is a
   separate programme.

## Important boundaries

- **Whole-workflow acceptance:** unit and source evidence do not prove a complete
  populated scientific workflow, permission isolation or frozen reconstruction.
  Roadmap 4's original parity harness currently registers no comparisons;
  historical port QA covers a different, narrower scope.
- **REUSE-02:** run `34094029808` failed in the September baseline. That is dated
  evidence, not a current reproduced failure; the old component was retired.
  SHEET-04 still needs equivalent default-value and template-update acceptance.
- **Scientific source ownership:** Sheet source pins and Definition-backed
  materialization already exist. SHEET-05 owns composed-source analysis;
  extend the existing materialization RPC rather than creating another engine.
  Dataset-schema editing does not implement ADR-0051 workspace Record Models.
- **Governance:** DEC-04/ADR-0045 is accepted, but signing step-up, expanded
  meanings and audit verification remain REV work. ADR-0044 and wider
  organisational/institutional deployment work remain separately gated.
- **Earlier follow-ups:** live AI provider acceptance, SDK publication, off-host
  recovery and populated restore evidence were not re-audited here. Consult
  their original task/handoff before treating them as complete.

## When taking a task

Read [agent context](agent/agent-context.md), [workflows](agent/workflows.md),
[PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md), [ROADMAP.md](ROADMAP.md),
the relevant current task status, subsystem contracts and accepted ADRs.
Then inspect current source and tests; old baseline descriptions are historical.

## Maintenance

This file owns cross-roadmap priority. Roadmap 4's [NEXT](roadmap-4/NEXT.md)
and nod tracker own its queue. [Roadmap 5](roadmap-5/README.md) is a proposal
without a queue of its own: its [programme map](roadmap-5/PROGRAMME_MAP.md) is a
status table and the root hand-off decides activation. Other programme folders
retain scope and history;
Roadmap 1's local NEXT is historical. Record the implementation revision,
validation evidence, limits and explicit deferrals whenever status changes.
Do not equate a merged PR or a rendered screen with full acceptance.
