# Post-Core Roadmap Tasks

These files are the detailed planning contracts for the post-Core programmes.

## Authority

- [`../NEXT.md`](../NEXT.md) identifies **active work per stream**. Agents take one assigned stream/task, not every Ready row.
- This folder defines epic goals, scope and exit criteria.
- [`../PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md) defines cross-programme product principles.
- Accepted ADRs remain authoritative for durable architecture.
- PC-00 accepted decisions: [`../audits/PC-00.md`](../audits/PC-00.md).

## Status

| Programme | Task file | Status |
| --- | --- | --- |
| Product Consolidation | [`PC.md`](./PC.md) | PC-01 merge-ready (#41); PC-02 Ready (medium) |
| API & Developer Platform | [`API.md`](./API.md) | API-01 merge-ready (#40); API-02 waits for merge |
| Data Interoperability | [`DATA.md`](./DATA.md) | Waiting on PC-01 merge |
| Governance | [`GOV.md`](./GOV.md) | GOV-01 queued (Medium when started; `viewer` read-only) |
| Collaboration | [`COLLAB.md`](./COLLAB.md) | planned |
| Scientific Analysis | [`SCI.md`](./SCI.md) | planned |
| Integrations | [`INT.md`](./INT.md) | planned |
| Platform & Operations | [`PLAT.md`](./PLAT.md) | PLAT-03 headers slice Ready (low) |
| Automation | [`AUTO.md`](./AUTO.md) | planned later |

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
