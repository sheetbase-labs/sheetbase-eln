---
title: Roadmaps 1–3 implementation reconciliation
status: historical-evidence
last_reviewed: 2026-09-07
---

# Roadmaps 1–3 — implementation reconciliation

## Baseline and scope

Author: Gareth Price <garethprice@me.com>.

Snapshot: [main at 832d9d6f3baaf0e42853d8fa71224f157b541c46](https://github.com/sheetbase-labs/sheetbase-eln/commit/832d9d6f3baaf0e42853d8fa71224f157b541c46),
7 September 2026. This record supports the documentation-only reconciliation;
[`../NEXT.md`](../NEXT.md) remains the sole current work hand-off.

The assessment compares roadmap/status documents, merged implementation and
selected code paths with GitHub PR and CI evidence. It is **not** a fresh
execution of the application, all historical acceptance criteria, a populated
recovery drill, or an audit of production deployments/users. Do not interpret
“not verified here” as “not implemented”, or “merged” as “accepted end to end”.

## Status vocabulary

| Term | Meaning |
| --- | --- |
| Recorded complete / active scope closed | The existing programme closure is retained. It is not independently re-certified by this reconciliation. |
| Merged implementation | Relevant implementation is present on the pinned `main`; task-level acceptance may still have limits or open verification. |
| Merged / limited | The implemented boundary is narrower than a broader product claim; the remaining capability is named explicitly. |
| Proposed | A decision document exists but acceptance and/or concrete intended-use evidence is outstanding. |
| Deferred | Work deliberately not implemented under the programme's stated adoption/decision gates. |
| Open verification | An observed failing check or missing acceptance evidence prevents an unqualified completion claim. |

Original task goals/exits remain unchanged. No ADR is accepted, no deferred task
is activated and no Roadmap 4 implementation is assigned by this change.

## Roadmap 1

CORE-01..06 and Core Hardening remain recorded complete. Sources are the
[Core index](../roadmap-1/README.md),
[historical Core hand-off](../roadmap-1/NEXT.md), and
[implementation review](../roadmap-1/CORE_01_06_IMPLEMENTATION_REVIEW.md).
The local Core `NEXT.md` is historical; its ordering is not the active queue.

## Roadmap 2

The active programme closure is retained for PC-00..06, API-01..07,
DATA-01..04, GOV-01/03/04, COLLAB-01..04, SCI-01..04, INT-01..03,
PLAT-01..05 and AUTO-01..05. GOV-02 remains deferred. This corrects the old
programme map/task index that still called PC-06 ready to merge, DATA-02..04
outstanding and collaboration/integrations/automation planned.

Implementation anchors include the current
[collaboration contract](../../subsystems/collaboration.md),
[file platform](../../subsystems/file-platform.md),
[integration contract](../../subsystems/integrations.md),
[visualisations](../../subsystems/visualisations.md),
[pipelines](../../subsystems/pipelines.md),
[agent operations](../../subsystems/agent-operations.md),
[agent workflows](../../subsystems/agent-workflows.md), and
[SDK source](../../../sdks/).
These establish implemented scope, not the absence of future work.

The completion wording must retain the limits below, especially Sheet-cell
comment anchors, import/analysis ceilings, provider integration and recovery.

## Roadmap 3 task accounting

The [task index](../roadmap-3/tasks/README.md) gives every numbered task a
status, including the ten institutional tasks. Its counts are:

| Programme | Task IDs | Merged implementation | Proposed | Deferred |
| --- | --- | ---: | ---: | ---: |
| Product Depth | NAV-01..03; GRID-01..05; NOTE-01..04; FIND-01..03 | 15 | 0 | 0 |
| Scientific Depth | KNOW-01..03; VIEW-01..04; MODEL-01..04; REUSE-01..03 | 14 | 0 | 0 |
| Open Platform | SDK-01..03; EVENT-01..03; EXT-01..03; ADMIN-01..03 | 12 | 0 | 0 |
| Intelligent Workspace | AI-01..03; ASSIST-01..03; AUTO-PLUS-01..03 | 9 | 0 | 0 |
| Institutionalise | ENT-ORG-01..03; GXP-01..04; OPS-01..03 | 0 | 2 | 8 |
| Total | 60 numbered tasks | 50 | 2 | 8 |

These are implementation dispositions, **not 50 independent acceptance
sign-offs**. REUSE-02 has an observed failing check; AI/ASSIST remain
stub-backed/bounded; full browser/API acceptance was not rerun here.

### Delivery evidence

Earlier Wave A implementation is on the baseline, including NAV-01/02,
GRID-01..04, NOTE-01..04, FIND-01/02 and SDK-01..03. The task-local notes
identify [#99](https://github.com/sheetbase-labs/sheetbase-eln/pull/99),
[#100](https://github.com/sheetbase-labs/sheetbase-eln/pull/100),
[#101](https://github.com/sheetbase-labs/sheetbase-eln/pull/101),
[#102](https://github.com/sheetbase-labs/sheetbase-eln/pull/102),
[#104](https://github.com/sheetbase-labs/sheetbase-eln/pull/104) and
[#110](https://github.com/sheetbase-labs/sheetbase-eln/pull/110); their old
“in review” wording is no longer the repository state.

The remainder was delivered through the linear stack:

```text
#127 NAV-03        #128 GRID-05       #129 FIND-03
#130..132 KNOW     #133..136 VIEW     #137..140 MODEL
#141..143 REUSE    #144..146 EVENT    #147..149 EXT
#150..152 ADMIN    #153..155 AI       #156..158 ASSIST
#159..161 AUTO-PLUS
#162 Wave D proposals and explicit deferrals
```

The final implementation PR
[#161](https://github.com/sheetbase-labs/sheetbase-eln/pull/161) and
proposal/deferral PR
[#162](https://github.com/sheetbase-labs/sheetbase-eln/pull/162) merged on
6 September 2026. The code and proposed decisions are present on the pinned
baseline; there is no remaining instruction to merge this stack in order.
A stack PR's merge flag alone is not evidence of full scientific acceptance.

## Concrete outstanding work and limits

### 1. CI and integrated acceptance

[CI run 34094029808](https://github.com/sheetbase-labs/sheetbase-eln/actions/runs/34094029808)
ran against the baseline and failed its unit job. The
[unit job](https://github.com/sheetbase-labs/sheetbase-eln/actions/runs/34094029808/job/101653496364)
reported 3,459 passing tests and one failure: REUSE-02's
`pre-fills declared defaults visibly on open` in
`src/components/templates/versioned-notebook-templates.test.tsx`, unable to
find display value `5` after the configured wait. This is an observed failure;
the log does not establish whether the cause is application state or test setup.
Do not call it harmless flakiness or merely raise the timeout again.

Database integration, static checks and production build passed in the same
run. [Security run 34123343710](https://github.com/sheetbase-labs/sheetbase-eln/actions/runs/34123343710)
was successful, but that does not override the failed CI run.

The [CI workflow](../../../.github/workflows/ci.yml) explicitly leaves
browser and API suites manual. This reconciliation did not execute those
suites or demonstrate a passing whole-workflow release gate.

### 2. AI and assistance are not live model integration

[`src/lib/ai-gateway.ts`](../../../src/lib/ai-gateway.ts) implements the
policy boundary, allowlists, budgets, telemetry and `ModelProvider` interface;
its only provider is `StubModelProvider`. Fixture model names/pricing are not
vendor models/pricing. [`assist-explain.ts`](../../../src/lib/assist-explain.ts)
primarily constructs deterministic explanations and has optional stub phrasing.

This is useful implemented infrastructure, not proof of live model-backed
scientific assistance. A real server-side provider integration and its quality,
grounding, permission, error and cost evaluation remain outstanding. Existing
bounded AUTO proposal/approval/provenance work must not be described as
unrestricted autonomous scientific execution.

### 3. Collaboration does not include Sheet-cell/range comments

The executable [anchor schema](../../../src/lib/collaboration/anchors.ts)
accepts `record`, `notebook-block`, `dataset`, `dataset-row`, `dataset-field`
and `dataset-cell`. It does not accept Sheet-cell/range anchors. The
[COLLAB task contract](../roadmap-2/tasks/COLLAB.md) retains that follow-up.
Dataset-cell comments must not be relabelled as support for a composed Sheet's
local, Record-backed or derived cells. The remaining design must reuse canonical
identity, not assume all Sheet row identities are absent or revive generated
`sheet_*` tables.

### 4. Intake, analysis and composed-source boundaries

The executable [import parser](../../../src/lib/import-parse.ts) sets a
10 MiB byte limit and 1,000-row limit. The
[scientific data layer](../../../src/lib/chart-data.ts) sets
`SCI_ANALYSIS_ROW_LIMIT = 10_000`. These are deliberate bounds, not evidence
that large editable Sheets can automatically complete every import, analysis,
freeze and export workflow.

The [visualisation reference](../../subsystems/visualisations.md) documents
one Dataset per visualisation, explicit field IDs, and no automatic promotion
of local Sheet columns. General analysis of a composed Sheet across multiple
sources/local calculations is not established by VIEW delivery. Any extension
must preserve one canonical ChartSpec and explicit provenance/materialisation.

### 5. SDK packaging versus publishing

The current [SDK release workflow](../../../.github/workflows/sdk-release.yml)
has `workflow_dispatch` enabled again and builds/tests/packages candidates.
Earlier task notes claiming all hosted runners are blocked and the dispatch
trigger is commented out are superseded. Publishing remains a manual maintainer
step; this reconciliation establishes neither a successful external registry
publication nor a live-service SDK acceptance run. Mock-transport smoke tests
are valuable but are not live-service evidence.

### 6. Backup tooling versus recovery proof

The [recovery runbook](../../operations/recovery.md) describes nightly
on-VPS backup sets, checksums, a disposable restore procedure and a successful
drill against an empty workspace set. The
[security posture](../../operations/security.md) leaves off-host backup/key
separation as follow-up. These documents do not prove that a populated
scientific workspace, attachments, frozen evidence and operational receipts
have been recovered after loss of the host. No production host was inspected
and no restore was executed in this reconciliation.

## Decisions and intentional deferrals

PR #162 delivered proposed ADR-0044 (organisation domain) and ADR-0045
(regulated controls), not implementation of Wave D. ENT-ORG-01 explicitly
requires an accepted ADR; that exit remains unmet. GXP-01 still needs a
concrete regulated intended use and control decision rather than only generic
intended-use categories.

ENT-ORG-02/03, GXP-02..04 and OPS-01..03 remain deferred. The recorded rationale
was absence of concrete adoption/intended-use evidence. This assessment does
not freshly verify that there are no users/data in a deployment. GOV-02 is
not silently reactivated. Existing review/signing features and existing PLAT
operations are not equivalent to completing the later regulated/institutional
exits.

## Follow-up and maintenance

[`../NEXT.md`](../NEXT.md) prioritises the failing check and consequential
acceptance verification before assigning further capability work. A Roadmap 4
proposal is not activated by this documentation PR.

Future status updates should name the implementation ref, the exact unmet or
accepted exit, test/deployment evidence, limits and explicit decision gates.
Do not add competing programme-local current hand-offs or rewrite historical
requirements to manufacture completion.
