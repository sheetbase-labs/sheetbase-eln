# Post-Core Roadmap Tasks

These files retain the detailed delivery contracts for Roadmap 2.

## Authority

- [`../../NEXT.md`](../../NEXT.md) identifies current work across all roadmaps.
- This folder defines epic goals, scope and exit criteria, not a competing work queue.
- [`../PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md) defines cross-programme product principles.
- Accepted ADRs remain authoritative for durable architecture.
- PC-00 accepted decisions: [`../audits/PC-00.md`](../audits/PC-00.md).

## Reconciled status — 7 September 2026

Roadmap 2's active scope is recorded closed at `main` `832d9d6`. “Recorded
closed” preserves the programme closure; it is not a fresh independent
acceptance test of every epic. Dated task-local implementation notes retain
historical evidence and must not be read as a current assignment.

| Programme                | Task file                | Reconciled status                                                                                                               |
| ------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Product Consolidation    | [`PC.md`](PC.md)         | PC-00..06 recorded closed; #55 is no longer an outstanding merge instruction.                                                   |
| API & Developer Platform | [`API.md`](API.md)       | API-01..07 recorded closed, including the initial SDKs and webhooks.                                                            |
| Data Interoperability    | [`DATA.md`](DATA.md)     | DATA-01..04 recorded closed; import/export/file limits remain explicit.                                                         |
| Governance               | [`GOV.md`](GOV.md)       | GOV-01/03/04 recorded closed; GOV-02 deferred pending an accepted organisation decision and adoption need.                      |
| Collaboration            | [`COLLAB.md`](COLLAB.md) | COLLAB-01..04 recorded closed within the implemented anchor contract; Sheet-cell/range anchors remain unimplemented.            |
| Scientific Analysis      | [`SCI.md`](SCI.md)       | SCI-01..04 recorded closed within the single-Dataset/bounded-analysis contract.                                                 |
| Integrations             | [`INT.md`](INT.md)       | INT-01..03 recorded closed; generic instrument, S3 and read-only PostgreSQL flows exist, not a universal vendor catalogue.      |
| Platform & Operations    | [`PLAT.md`](PLAT.md)     | PLAT-01..05 recorded closed within documented deployment/security/performance limits; later institutional OPS work is deferred. |
| Automation               | [`AUTO.md`](AUTO.md)     | AUTO-01..05 recorded closed; canonical deterministic and bounded proposal/workflow execution, not a live model provider.        |

The [reconciliation record](../../history/2026-09-07-roadmap-reconciliation.md)
links implementation evidence and separates observed failures from intentional
limits. In particular, neither programme closure nor a merged PR establishes
passing current browser/API acceptance or production readiness.

## Task-file convention

Each epic should state:

- goal;
- why it exists;
- dependencies;
- user/platform outcomes;
- principal scope;
- important boundaries/non-goals;
- acceptance/exit criteria;
- implementation risks or decisions that require an ADR.

Before assigning follow-up work, identify the specific unmet outcome and inspect
the existing implementation. Do not restart a completed foundation because an
old task note says “planned”, or count an intentionally deferred capability as
implemented. Refine the assigned task sufficiently for an agent to work safely.
