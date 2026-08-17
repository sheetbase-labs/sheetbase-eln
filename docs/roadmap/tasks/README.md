# Post-Core Roadmap Tasks

These files are the detailed planning contracts for the post-Core programmes.

## Authority

- [`../NEXT.md`](../NEXT.md) identifies the active task.
- This folder defines epic goals, scope and exit criteria.
- [`../PRODUCT_DIRECTION.md`](../PRODUCT_DIRECTION.md) defines cross-programme product principles.
- Accepted ADRs remain authoritative for durable architecture.

## Status

| Programme | Task file | Status |
| --- | --- | --- |
| Product Consolidation | [`PC.md`](./PC.md) | PC-00 complete; PC-01 active |
| API & Developer Platform | [`API.md`](./API.md) | planned; API-01 parallel with PC-01 |
| Data Interoperability | [`DATA.md`](./DATA.md) | planned; DATA-01 after PC-01 paste |
| Governance | [`GOV.md`](./GOV.md) | planned; GOV-01 `viewer` decision |
| Collaboration | [`COLLAB.md`](./COLLAB.md) | planned |
| Scientific Analysis | [`SCI.md`](./SCI.md) | planned |
| Integrations | [`INT.md`](./INT.md) | planned |
| Platform & Operations | [`PLAT.md`](./PLAT.md) | planned; some work may run continuously |
| Automation | [`AUTO.md`](./AUTO.md) | planned; later |

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
