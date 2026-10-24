# Roadmap 3 Tasks

Roadmap 3 contains **60 numbered tasks across 18 capability streams**. Each
capability file retains the original goals, scope, boundaries and exit criteria.

## Reconciled status — 7 September 2026

Baseline: `main` at `832d9d6f3baaf0e42853d8fa71224f157b541c46`.

**50 tasks have merged implementation, two have proposed decisions, and eight
are deliberately deferred. This is not a claim that 60 tasks are accepted
complete.** “Merged” below establishes repository delivery, not independent
revalidation of every task exit, deployment, or production readiness.

| Programme             | Stream / tasks                   | Count | Implementation and qualification                                                                              |
| --------------------- | -------------------------------- | ----: | ------------------------------------------------------------------------------------------------------------- |
| Product Depth         | [NAV-01..03](NAV.md)             |     3 | Merged; NAV-02 #104 and NAV-03 #127 are no longer in review/planned.                                          |
| Product Depth         | [GRID-01..05](GRID.md)           |     5 | Merged, including GRID-05 #128; performance claims remain bounded to measured scenarios.                      |
| Product Depth         | [NOTE-01..04](NOTE.md)           |     4 | Merged; earlier Wave A authoring/evidence work is on `main`.                                                  |
| Product Depth         | [FIND-01..03](FIND.md)           |     3 | Merged, including FIND-03 #129.                                                                               |
| Scientific Depth      | [KNOW-01..03](KNOW.md)           |     3 | Merged, #130..132.                                                                                            |
| Scientific Depth      | [VIEW-01..04](VIEW.md)           |     4 | Merged, #133..136; representation delivery does not remove ChartSpec source/analysis limits.                  |
| Scientific Depth      | [MODEL-01..04](MODEL.md)         |     4 | Merged, #137..140.                                                                                            |
| Scientific Depth      | [REUSE-01..03](REUSE.md)         |     3 | Merged, #141..143; REUSE-02 template-default verification is failing in baseline CI.                          |
| Open Platform         | [SDK-01..03](SDK.md)             |     3 | Merged, #101/#102/#110; manual release-candidate dispatch is re-enabled, publishing remains manual.           |
| Open Platform         | [EVENT-01..03](EVENT.md)         |     3 | Merged, #144..146.                                                                                            |
| Open Platform         | [EXT-01..03](EXT.md)             |     3 | Merged, #147..149; bounded extension contracts, not proof of an external plugin marketplace.                  |
| Open Platform         | [ADMIN-01..03](ADMIN.md)         |     3 | Merged, #150..152.                                                                                            |
| Intelligent Workspace | [AI-01..03](AI.md)               |     3 | Merged, #153..155; context/retrieval/policy substrate with a deterministic stub provider.                     |
| Intelligent Workspace | [ASSIST-01..03](ASSIST.md)       |     3 | Merged, #156..158; bounded explanations/proposals/guidance, not live model-backed assistance.                 |
| Intelligent Workspace | [AUTO-PLUS-01..03](AUTO_PLUS.md) |     3 | Merged, #159..161; bounded canonical tools, approvals, provenance and evaluations, not unrestricted autonomy. |
| Institutionalise      | [ENT-ORG-01](ENT_ORG.md)         |     1 | Proposed ADR-0044 in #162; accepted-ADR exit not met.                                                         |
| Institutionalise      | [ENT-ORG-02/03](ENT_ORG.md)      |     2 | Deferred; accepted ADR plus concrete adoption need required.                                                  |
| Institutionalise      | [GXP-01](GXP.md)                 |     1 | Proposed ADR-0045 in #162; concrete intended-use/control decision outstanding.                                |
| Institutionalise      | [GXP-02..04](GXP.md)             |     3 | Deferred; intended-use and control gates required.                                                            |
| Institutionalise      | [OPS-01..03](OPS.md)             |     3 | Deferred; explicit institutional deployment/adoption decision required.                                       |

Programme totals remain Product Depth 15, Scientific Depth 14, Open Platform
12, Intelligent Workspace 9, and Institutionalise 10. Wave A included SDK;
the wave labels are delivery sequencing, not a different task count.

See the [reconciliation record](../../../2026-09-07-roadmap-reconciliation.md)
for evidence, known limits and assessment scope. The two proposed ADRs have not
been accepted by this documentation change. The original task exits are not
weakened to fit the implementation.

## Assignment rule

A task is not Ready merely because it appears here. It becomes current only when:

1. its dependencies are satisfied;
2. any required ADR is accepted;
3. repository-wide [`../../NEXT.md`](../../../../NEXT.md) or an explicit assignment selects it.

Read the reconciled status before using a historical stream prompt. Do not
restart merged work, silently activate deferred work, or treat this
reconciliation as approval to implement Roadmap 4.

Implement the **whole assigned numbered task** and its exit criterion. Do not
silently bundle the next task in the same capability stream or ambiguous pieces
of adjacent streams.
