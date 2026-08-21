# Post-Core Roadmap Tasks

These files are the detailed planning contracts for the post-Core programmes.

## Authority

- [`../NEXT.md`](../NEXT.md) identifies **active work per stream**. Agents take one assigned stream/task, not every Ready row.
- This folder defines epic goals, scope and exit criteria.
- [`../PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md) defines cross-programme product principles.
- Accepted ADRs remain authoritative for durable architecture.
- PC-00 accepted decisions: [`../audits/PC-00.md`](../audits/PC-00.md).

## Status

| Programme                | Task file                  | Status                                                 |
| ------------------------ | -------------------------- | ------------------------------------------------------ |
| Product Consolidation    | [`PC.md`](./PC.md)         | PC-00–05 complete; PC-06 ready to merge (`#55`)        |
| API & Developer Platform | [`API.md`](./API.md)       | API-01, API-02, API-07 and API-03 complete             |
| Data Interoperability    | [`DATA.md`](./DATA.md)     | DATA-01 complete; DATA-02/03/04 remain                 |
| Governance               | [`GOV.md`](./GOV.md)       | GOV-01 complete (`viewer` read-only); GOV-02 needs ADR |
| Collaboration            | [`COLLAB.md`](./COLLAB.md) | planned                                                |
| Scientific Analysis      | [`SCI.md`](./SCI.md)       | planned                                                |
| Integrations             | [`INT.md`](./INT.md)       | planned                                                |
| Platform & Operations    | [`PLAT.md`](./PLAT.md)     | PLAT-03 headers complete; remainder queued             |
| Automation               | [`AUTO.md`](./AUTO.md)     | planned later                                          |

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

Before implementation, refine the relevant epic into granular numbered tasks if the current file is not detailed enough to hand to an agent safely. Do not treat a broad planning bullet as permission to invent architecture.
