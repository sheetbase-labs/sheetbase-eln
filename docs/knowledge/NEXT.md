---
title: Sheetbase Current Work
status: canonical
last_reviewed: 2026-09-07
---

# Sheetbase — Current Work

This is the single current hand-off for Sheetbase development across roadmaps.
Start here when deciding what work is active or next.

## Current branch work

`GWP/design-overhaul` contains the requested interface improvements and the
Python/ELN Pipeline extension described in [ADR-0046](decisions/0046-python-and-eln-pipeline-actions.md).
This is local branch work, not a merged or production deployment claim. The
local Python runner is configured; deployment requires reviewed immutable
runner/runtime images and private runner configuration.

The work is published in [PR #176](https://github.com/sheetbase-labs/sheetbase-eln/pull/176).
See the [Python/SQL pipeline handoff and proposed follow-on roadmap](handoffs/python-sql-pipelines.md)
for setup, implementation details, validation limits and the next bounded tasks.
PR publication does not establish merge or production acceptance.

## Reconciled baseline

Reconciled against `main` at `832d9d6f3baaf0e42853d8fa71224f157b541c46`
(7 September 2026). The [reconciliation record](history/2026-09-07-roadmap-reconciliation.md)
contains the evidence, status definitions and limits of this assessment.

```text
Roadmap 1    RECORDED COMPLETE — CORE-01..06 and Core Hardening
Roadmap 2    ACTIVE SCOPE CLOSED — GOV-02 deferred; known limits remain
Roadmap 3    WAVES A–C MERGED — not a blanket acceptance/release sign-off
             WAVE D — 2 proposed decisions; 8 deferred implementation tasks
Roadmap 4    PROPOSAL ONLY — not activated by this reconciliation
```

**Merged is not the same as accepted, deployed or production-ready.** This
reconciliation preserves historical programme closure, identifies implementation
present on `main`, and records concrete outstanding work. It does not certify
that every historical exit criterion has been independently re-tested.

## What has landed

Roadmap 1 established the canonical schema, Dataset, compositional Sheet,
Record-creation, evolution, reuse and frozen-evidence contracts.

Roadmap 2's active programmes are recorded closed: PC, API, DATA, GOV except
GOV-02, COLLAB, SCI, INT, PLAT and AUTO. In particular, AUTO-04/05's bounded
proposal/workflow contracts are implemented; they are not a live model-provider
integration. See [Roadmap 2 status](roadmap-2/tasks/README.md).

Roadmap 3 has implementation on `main` for the 50 numbered tasks in Product
Depth, Scientific Depth, Open Platform and Intelligent Workspace. The earlier
Wave A work and the `#127 → … → #161` stack are no longer waiting for review or
ordered merging. PR #162 also merged, but it delivered proposals and deferrals,
not the remaining institutional capabilities. See [Roadmap 3 task status](roadmap-3/tasks/README.md).

## Outstanding implementation and verification

| Area                         | Actual boundary / outstanding work                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| CI / REUSE-02                | Baseline CI run `34094029808` failed: `versioned-notebook-templates.test.tsx` could not find the declared default value `5`. Diagnose and fix; do not assume flakiness. Static checks, database integration and production build passed in that run.                                                                     |
| Whole-workflow acceptance    | The CI workflow leaves browser and live API suites manual. Their presence is not evidence of a passing integrated release gate. Revalidate selected end-to-end exits against real services.                                                                                                                              |
| AI / ASSIST                  | Context, retrieval, policy and assistive interfaces are implemented; the gateway's only provider is a deterministic stub. Real model calls and real-provider quality/cost evaluation remain outstanding.                                                                                                                 |
| Collaboration                | Record, Notebook-block and Dataset anchors exist. Canonical Sheet-cell/range comment anchors are not implemented; do not equate Dataset-cell comments with Sheet-cell comments.                                                                                                                                          |
| Scientific analysis / intake | The import parser caps files at 10 MiB and tables at 1,000 rows; the scientific data layer caps analysis at 10,000 rows. The visualisation contract is single-Dataset and does not automatically include local Sheet columns. Broader workload/composed-source support is not delivered by declaring GRID/VIEW complete. |
| SDK release                  | Manual release-candidate workflow dispatch is enabled again. Publishing remains a maintainer operation; no successful registry publication or live-service SDK acceptance was established by this reconciliation.                                                                                                        |
| Recovery                     | Backup/restore tooling exists. The documented baseline retains backups on the VPS and cites an empty-workspace drill. Off-host protection and populated scientific-workspace recovery proof remain outstanding.                                                                                                          |

These are a mix of observed failing checks, intentional limits and missing
capabilities. They are not all regressions, and this table is not an exhaustive
code audit. Source references and qualification are in the reconciliation record.

## Deferred decisions and work

| Task          | Status and activation condition                                                                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GOV-02        | Deferred. Revisited through ENT-ORG; do not implement a second organisation model.                                                                                 |
| ENT-ORG-01    | ADR-0044 is **proposed**, not accepted. The task's accepted-ADR exit is not met.                                                                                   |
| ENT-ORG-02/03 | Deferred until an accepted organisation ADR and a concrete multi-workspace/team adoption need exist.                                                               |
| GXP-01        | ADR-0045 is **proposed**. A concrete regulated intended use and accepted control decision remain outstanding.                                                      |
| GXP-02..04    | Deferred until the intended-use/control gates are met and work is explicitly assigned. Existing review/signing controls do not establish regulated-use validation. |
| OPS-01..03    | Deferred institutional work; requires an explicit deployment/adoption decision. Existing PLAT implementation is not proof that these later exits are met.          |

Do not silently accept ADRs, relax their exits, or relabel deferred work as
complete. The previously recorded absence of production adoption is the rationale
for the deferral, not a fresh audit of deployment users or data.

## Next work, in order

1. Resolve the baseline CI failure with a demonstrated cause and a passing
   regression test. Preserve assertions; do not hide failures with exclusions.
2. Revalidate the highest-consequence integrated exits: first-use/template
   instantiation, composed Sheet write-back, review/frozen reconstruction,
   permission isolation and populated recovery. Record evidence and remaining
   gaps rather than automatically reopening or re-completing whole roadmaps.
3. Agree which documented capability gaps become the next implementation tasks.
   The Roadmap 4 proposal is not an assignment and is not activated here.
4. Decide ADR-0044/0045 only when the relevant adoption/intended-use evidence is
   available. Earlier roadmaps landing does not remove their gates.

This documentation reconciliation does not fix application code, change
workflows, publish SDKs, deploy services, or activate a new capability stream.

## When taking a task

Read, in order:

1. [`agent/agent-context.md`](agent/agent-context.md)
2. [`agent/workflows.md`](agent/workflows.md)
3. [`PRODUCT.md`](PRODUCT.md)
4. [`DESIGN.md`](DESIGN.md)
5. [`ROADMAP.md`](ROADMAP.md)
6. the relevant roadmap programme/task file and reconciled status;
7. relevant architecture documents and accepted ADRs;
8. current implementation/subsystem docs under `docs/`.

Then inspect the actual code and tests. Documentation is context and contract,
not a substitute for implementation evidence.

## Maintenance rule

Update this file whenever merged reality materially changes what is active or
next. Programme folders retain scope, task definitions and historical evidence;
they do not own a competing current hand-off. Roadmap 1's retained local
`NEXT.md` is historical, not an active work queue.

For status changes, record the implementation ref, validation evidence, known
limits and explicit deferrals. Never use a merged PR alone as acceptance proof.
