# Roadmap 3 — Programme Map

## Reconciled state

At `main` `832d9d6` on 7 September 2026, Waves A–C have merged implementation.
Wave D has two proposed decisions and eight deferred tasks. The
[task index](tasks/README.md) accounts for all 60 tasks; the
[reconciliation record](../history/2026-09-07-roadmap-reconciliation.md) records
evidence and limits. Merged implementation is not a blanket acceptance or
production-readiness sign-off.

Repository-wide [`../NEXT.md`](../NEXT.md) remains the single current hand-off.
The original Roadmap 2 entry condition has been passed; do not restart Roadmap 3
or the completed stack from this historical dependency map.

## Programme shape

```text
                         ROADMAP 2 ACTIVE SCOPE CLOSED
                                |
                                v
                     +---------------------+
                     |   PRODUCT DEPTH     |
                     | NAV GRID NOTE FIND  |
                     +----------+----------+
                                |
                    +-----------+-----------+
                    |                       |
                    v                       v
          +-------------------+    +-------------------+
          | SCIENTIFIC DEPTH  |    |   OPEN PLATFORM   |
          | KNOW VIEW MODEL   |    | SDK EVENT EXT     |
          | REUSE             |    | ADMIN             |
          +---------+---------+    +---------+---------+
                    |                        |
                    +-----------+------------+
                                |
                                v
                    +-----------------------+
                    | INTELLIGENT WORKSPACE |
                    | AI ASSIST AUTO+       |
                    +-----------+-----------+
                                |
                                v
                    +-----------------------+
                    |   INSTITUTIONALISE   |
                    | ENT-ORG GXP OPS       |
                    +-----------------------+
```

This is a dependency shape, not a forced serial queue. Independent numbered
tasks may proceed only when dependencies, decision gates and explicit
assignment are satisfied.

## Capability streams

| Programme | Stream | Tasks | Principal prerequisite |
| --- | --- | --- | --- |
| Product Depth | NAV | NAV-01..03 | Roadmap 2 active scope closed |
| Product Depth | GRID | GRID-01..05 | Roadmap 2 active scope closed |
| Product Depth | NOTE | NOTE-01..04 | Roadmap 2 active scope closed |
| Product Depth | FIND | FIND-01..03 | NAV-01 recommended |
| Scientific Depth | KNOW | KNOW-01..03 | Canonical identities; NAV-02 useful |
| Scientific Depth | VIEW | VIEW-01..04 | SCI-04; GRID maturity useful |
| Scientific Depth | MODEL | MODEL-01..04 | Roadmap 1 Model/Field contracts |
| Scientific Depth | REUSE | REUSE-01..03 | NOTE/MODEL foundations |
| Open Platform | SDK | SDK-01..03 | Roadmap 2 API-04/05 |
| Open Platform | EVENT | EVENT-01..03 | Roadmap 2 API-06 |
| Open Platform | EXT | EXT-01..03 | SDK/EVENT maturity |
| Open Platform | ADMIN | ADMIN-01..03 | Roadmap 2 GOV/PLAT foundations |
| Intelligent Workspace | AI | AI-01..03 | Canonical context/permissions; KNOW useful |
| Intelligent Workspace | ASSIST | ASSIST-01..03 | AI-01..03; mature GRID/NOTE |
| Intelligent Workspace | AUTO+ | AUTO-PLUS-01..03 | Roadmap 2 AUTO-04/05; EVENT/AI |
| Institutionalise | ENT-ORG | ENT-ORG-01..03 | Concrete adoption need + accepted ADR |
| Institutionalise | GXP | GXP-01..04 | Concrete regulated intended use |
| Institutionalise | OPS | OPS-01..03 | Institutional scale/adoption evidence |

## Within-stream sequencing

The task files retain their original sequential contracts:

```text
NAV:      01 model -> 02 context -> 03 productivity
GRID:     01 selection -> 02 range ops -> 03 typed editing -> 04 views -> 05 scale
NOTE:     01 authoring -> 02 structure -> 03 scientific composition -> 04 review/evidence
FIND:     01 recents -> 02 favourites -> 03 contextual discovery

KNOW:     01 relationships -> 02 lineage -> 03 quality/API maturity
VIEW:     01 framework -> 02 spatial -> 03 comparative -> 04 export/evidence
MODEL:    01 authoring -> 02 field semantics -> 03 relationships -> 04 evolution
REUSE:    01 discovery -> 02 parameterised composition -> 03 upgrades

SDK:      01 parity -> 02 ergonomics -> 03 release/lifecycle
EVENT:    01 catalogue -> 02 delivery/replay -> 03 platform consumption
EXT:      01 contract -> 02 UI/commands -> 03 distribution/trust
ADMIN:    01 IA -> 02 access/integrations -> 03 health/diagnostics

AI:       01 context -> 02 retrieval/citation -> 03 gateway/policy
ASSIST:   01 explain -> 02 draft/transform -> 03 guided workflows
AUTO+:    01 tool catalogue -> 02 plans/approval -> 03 provenance/evaluation

ENT-ORG:  01 ADR -> 02 membership/governance -> 03 teams/shared ops
GXP:      01 intended-use model -> 02 controlled change -> 03 review/sign -> 04 validation pack
OPS:      01 SLO/scale -> 02 resilience/DR -> 03 security/observability
```

## Wave disposition

### Wave A — Product Depth and early SDK work

Implementation merged: NAV-01..03, GRID-01..05, NOTE-01..04, FIND-01..03 and
SDK-01..03. The final Product Depth remainder landed through #127..129.
These are no longer “in review” or unstarted tasks. Interaction/performance
acceptance remains limited to the evidence actually demonstrated.

### Wave B — Scientific Depth + remaining Open Platform

Implementation merged: KNOW, VIEW, MODEL, REUSE, EVENT, EXT and ADMIN through
#130..152. REUSE-02's template-default test is failing in the baseline CI run;
merged implementation does not erase that open verification item.

### Wave C — Intelligent Workspace

Bounded implementation merged through #153..161. AI context/retrieval/policy,
ASSIST interfaces and AUTO+ tools/plans/provenance exist. The gateway's only
model provider is a deterministic stub; live model integration and real-provider
scientific evaluation are not established by this wave's merged status.

### Wave D — Institutionalise

PR #162 merged **proposals and deferrals**, not the institutional implementation.
ENT-ORG-01 has proposed ADR-0044; GXP-01 has proposed ADR-0045. Neither is an
accepted decision or completed concrete-use implementation. ENT-ORG-02/03,
GXP-02..04 and OPS-01..03 remain deferred. Earlier waves completing does not
make them Ready.

## Cross-cutting invariants

Every task preserves:

- one canonical Notebook / Sheet / Dataset / Model / Record model;
- PostgreSQL/RLS/server authority;
- stable semantic identity;
- explicit local vs governed state;
- explicit write targets and provenance;
- Dataset Version / Definition Version / submitted-evidence boundaries;
- one capability system, connector framework, Pipeline model and ChartSpec;
- one public domain contract for browser/SDK/integration/automation clients.

## Ready rule

A numbered task becomes Ready only when:

1. its dependencies are satisfied;
2. its task section has a complete exit criterion;
3. any required ADR is accepted;
4. root [`../NEXT.md`](../NEXT.md) or an explicit assignment identifies it as current work.

Roadmap order alone does not assign work. No Roadmap 4 implementation is
activated by this reconciliation.
