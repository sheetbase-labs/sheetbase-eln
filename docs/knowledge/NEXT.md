---
title: Sheetbase Current Work
status: canonical
last_reviewed: 2026-10-22
---

# Sheetbase — Current Work

**Every Roadmap 4 active task is recorded complete.** The work is
merged to `main` as `10a84a42` (PR #220, 11 October 2026); the branch was
`GWP/roadmap-4-shell`. Its [reconciliation](roadmap-4/RECONCILIATION.md) covers
all 86 original tasks and its evidence and limits still stand: task completion is
not release acceptance. That handoff deferred visual and browser acceptance;
the scoped closure below now includes executable acceptance for assigned paths.
The [Roadmap 4 handoff](roadmap-4/NEXT.md)
and nod tracker own its queue.

**Smooth-journeys work (19–20 October 2026).** After Roadmap 4, PRs #235–#244
worked through the cross-page user-journey audit (158 journeys): one experiment
frame, the Inbox as a work queue, bench and lab flows, dataset snapshots as
analysis sources, compare across datasets, qualification requests, the
conclusion block and server-side search. CORE-01..14 run as Playwright specs in
`tests/browser/journeys/`. The October journey map predates that work, so
re-check a journey against the current screens before treating it as open.
This is source and local-test evidence, not release acceptance.

[Roadmap 5](roadmap-5/README.md) records all 22 interface-closure tasks
implemented through PR #222, including the additional R5-CONFIG-06. Its
[programme map](roadmap-5/PROGRAMME_MAP.md) records implementation, not
whole-programme acceptance. It keeps no competing queue. The separate, unnumbered
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
| Roadmap 5 | All 22 interface-closure tasks recorded implemented through PR #222. Programme acceptance remains outstanding; consult its programme map and current source, not the earlier proposed status. Unfinished Roadmap 4 requirements retain their original task owner. The unnumbered complete-scientific-workflows proposal is separate.                                                                                                                                              |

The [7 September reconciliation](history/2026-09-07-roadmap-reconciliation.md)
remains historical evidence for Roadmaps 1–3. This update audits Roadmap 4;
it does not re-run all earlier programme exits. Recorded completion, source
implementation, independent acceptance and deployment are different claims.

## Current closure scope (22 October audit)

The owner authorised one integrated PR for the following source-confirmed gaps,
not a new application rewrite. The audit baseline is
[`294bfbf`](https://github.com/sheetbase-labs/sheetbase-eln/commit/294bfbfb655a9dd329e00591bcee848425ffbbb4).
Existing task and subsystem contracts retain ownership.

1. Close access and evidence correctness first. Collaboration must obey current
   project and private-draft authority. DSET-01/SHEET-05 must preserve the
   analysed population, pinned snapshot and historical schema interpretation
   through Studio, notebook citation, freeze and reconstruction.
2. Close daily-work recovery. A requested repeat must reach bench readings;
   Inbox counts, filtering and navigation must not hide actionable work. Import
   must record worksheet choice and interpret units without silently relabelling
   numbers. Full-data analysis must not silently stop at the old 10,000-row cap.
3. Prove the existing governed and automation paths. Restore executable CI;
   exercise populated import, analysis, independent review and signing, real
   SDK requests and SQL/Python pipeline output. Repair webhook catch-up and
   concurrent retry ownership. Reuse existing models, materialisation and workers.
4. Repair repository-owned recovery and monitoring gates. Prove populated
   replacement recovery with request-role grants and object checksums. Require
   a fresh backup before migrations. Off-host storage, key custody, alert delivery,
   RPO/RTO and a real fresh-host drill still need operator decisions and evidence.

Local checks, hosted CI, scientist usability observation and deployment are
separate evidence. Do not turn a passing targeted test into programme acceptance.

### Local acceptance for this closure

The integrated branch implements the four groups above. The final local runs
use PostgreSQL 18, PostgREST 14.5, Node 22.23.2 and disposable test databases:

- `pnpm test --maxWorkers=4`: 6,195 passed, 11 skipped.
- `PIPELINE_ACCEPTANCE_PYTHON=/tmp/sheetbase-acceptance-python/bin/python pnpm test:db --maxWorkers=2`:
  1,867 passed across 251 files, including installed SDKs, real SQL/Python output,
  TLS SMTP credential enrolment, collaboration authority and populated recovery.
- `pnpm test:api`: 144 passed across 18 files, with per-file database and
  PostgREST isolation rather than destructive fixture cleanup.
- The complete scientific workflow in [testing.md](../development/testing.md)
  passes in Chromium. It imports 96 observations, saves and immediately cites
  the pinned analysis, submits, independently reviews and signs, then reloads
  the frozen notebook with n = 96 and mean = 48.5 unchanged.
- `pnpm exec playwright test --config playwright.signatures.config.ts --workers=1`:
  all three native signing, witness, signature-history and amendment tests pass.
  A temporary browser probe also verifies that a changed-revision response
  removes the prior statistics and displays the reload error. This probe injects
  the response fault; it is not a concurrent database-write acceptance test.
- `pnpm typecheck`, `pnpm lint`, `pnpm check` and `pnpm build` pass. Lint reports
  33 existing warnings and no errors. Fresh and warm `.agents/setup` runs pass.

Live analysis now refuses changed page revisions, schema metadata or exclusion
flags during loading instead of presenting a mixed population or stale result.
Submission integrity binds signatures to the exact frozen snapshot, without
rewriting historical evidence.

The browser proof also exposes a separate traversal gap: canonical imported
Datasets can appear as unavailable name-only record links in the notebook
Relationships and Lineage panels. The frozen analysis still reconstructs its
values and has an Open dataset link. Those panels currently resolve
`api.records`, not canonical `api.datasets`; closing that identity boundary
needs permission-preserving Dataset traversal, not a duplicate Dataset record.
The screenshot also retains existing low-contrast frozen content and clipped
sidebar text. This is not whole-application usability or visual acceptance.

## Important boundaries

- **Whole-workflow acceptance:** unit and source evidence do not prove a complete
  populated scientific workflow, permission isolation or frozen reconstruction.
  At the audit baseline the visual registry maps 45 screens and leaves 81
  pending, including review/evidence states. Reconcile the adopted reference
  contract before claiming complete parity; it is not a zero-comparison harness.
- **REUSE-02:** run `34094029808` failed in the September baseline. That is dated
  evidence, not a current reproduced failure; the old component was retired.
  SHEET-04 still needs equivalent default-value and template-update acceptance.
- **Scientific source ownership:** Sheet source pins and Definition-backed
  materialization already exist. SHEET-05 owns composed-source analysis;
  extend the existing materialization RPC rather than creating another engine.
  Workspace Record Models and version approval also exist; model v1/v2 identity
  and historical reconstruction need acceptance, not a second model system.
- **Governance:** DEC-04/ADR-0045 is accepted. Signing step-up, expanded
  meanings and audit verification have implementations. Their existence is not
  identity-provider or production enrolment acceptance. ADR-0044 and wider
  organisational/institutional deployment work remain separately gated.
- **External acceptance:** existing Liveblocks tokens and sockets are not
  immediately revoked by the new grant checks. Hosted-provider behaviour,
  external SMTP delivery, OAuth/IdP, OCI pipeline isolation, SDK publication,
  off-host recovery and populated Docker/application recovery remain unproved.
  The local PostgreSQL replacement drill is not a fresh-host traffic-switch
  rehearsal. Operators still own target selection, key custody, retention,
  RPO/RTO and alert delivery. No deployment or production write is part of this PR.

## When taking a task

Read [agent context](agent/agent-context.md), [workflows](agent/workflows.md),
[PRODUCT.md](PRODUCT.md), [DESIGN.md](DESIGN.md), [ROADMAP.md](ROADMAP.md),
the relevant current task status, subsystem contracts and accepted ADRs.
Then inspect current source and tests; old baseline descriptions are historical.

## Maintenance

This file owns cross-roadmap priority. Roadmap 4's [NEXT](roadmap-4/NEXT.md)
and nod tracker retain their historical task status. [Roadmap 5](roadmap-5/README.md)
has no queue of its own: its [programme map](roadmap-5/PROGRAMME_MAP.md) is an
implementation status table, not an acceptance certificate. Other programme folders
retain scope and history;
Roadmap 1's local NEXT is historical. Record the implementation revision,
validation evidence, limits and explicit deferrals whenever status changes.
Do not equate a merged PR or a rendered screen with full acceptance.
