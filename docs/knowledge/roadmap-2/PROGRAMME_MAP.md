# Sheetbase Post-Core Programme Map

## Reconciled programme state

Roadmap 2's active scope is recorded closed as of 7 September 2026, baseline
`main` `832d9d6`. GOV-02 remains deferred. This map no longer assigns the
superseded early-programme queue. [`../NEXT.md`](../NEXT.md) owns current work;
[task status](tasks/README.md) and the
[reconciliation record](../history/2026-09-07-roadmap-reconciliation.md) distinguish
recorded closure from known limits and unverified acceptance.

## Programmes

| Programme | Objective | Disposition |
| --- | --- | --- |
| PC | One coherent scientist-facing product | Active scope recorded closed |
| API | Public API, credentials, SDKs, webhooks and developer experience | Active scope recorded closed |
| DATA | Import, export, files, search and portability | Active scope recorded closed; limits remain |
| GOV | Roles, audit, review/signatures and policy | GOV-01/03/04 recorded closed; GOV-02 deferred |
| COLLAB | Presence, comments, notifications and review coordination | Recorded closed within supported anchors; Sheet-cell/range follow-up outstanding |
| SCI | Charts, analysis and scientific exploration | Recorded closed within bounded scientific source/analysis contracts |
| INT | Generic connectors, instruments and external data sources | Recorded closed for representative implemented adapters |
| PLAT | Deployment, observability, security and administration | Recorded closed within documented operating limits |
| AUTO | Deterministic Pipelines and bounded agent operations | Active scope recorded closed; no live-provider claim |

## Dependency shape

This is the programme's architectural dependency shape, not a current queue.

```text
                       CORE COMPLETE
                            |
              +-------------+-------------+
              |             |             |
              v             v             v
             PC            API           DATA
              |             |             |
              +------+------+-+-----------+
                     |        |
                    GOV      PLAT
                     |        |
              +------+------+------+
              |             |       |
              v             v       v
           COLLAB           SCI     INT
                            |
                            v
                           AUTO
```

## Delivered programme scope

Detailed goals, boundaries and exits remain in the task files. The disposition
below retains historical programme closure; it is not a fresh full-code audit.

### PC — Product Consolidation

PC-00 Product & Platform Consolidation Audit; PC-01 Canonical Sheet Experience;
PC-02 Dataset & Record Product Workflows; PC-03 Notebook Experience;
PC-04 Templates & Reusable Science; PC-05 Configuration & Steward Workspace;
PC-06 Golden Workflow Consolidation — recorded closed. PC-06/#55 is no longer
a “ready to merge” instruction.

### API — API & Developer Platform

API-01 Public API Contract; API-02 API Credentials & Service Identity;
API-03 OpenAPI & Documentation; API-04 Python SDK; API-05 TypeScript SDK;
API-06 Webhooks & Event Delivery; API-07's canonical external-contract work —
recorded closed. Roadmap 3 SDK/EVENT work extends these foundations rather than
standing in for an unstarted Roadmap 2 API stream.

### DATA — Data Interoperability

DATA-01 Import Framework; DATA-02 Export & Portability;
DATA-03 File & Attachment Platform; DATA-04 Global Search — recorded closed.
The implemented import and transfer bounds remain deliberate product limits.

### GOV — Identity, Administration & Governance

GOV-01 Role & Capability Productisation; GOV-03 Audit & History Experience;
GOV-04 Electronic Records, Review & Signatures — recorded closed. `viewer`
remains read-only. GOV-02 Organisation Model is **deferred**, revisited through
Roadmap 3 ENT-ORG and proposed ADR-0044, not completed or silently activated.

### COLLAB — Collaboration

COLLAB-01 Presence & Concurrent Awareness; COLLAB-02 Comments, Mentions &
Resolution; COLLAB-03 Notifications; COLLAB-04 Lightweight Review & Tasks —
recorded closed within the implemented Record/Notebook/Dataset anchor contract.
Canonical Sheet-cell/range comment anchors remain outstanding.

### SCI — Scientific Analysis & Visualisation

SCI-01 Charting; SCI-02 Analysis Framework; SCI-03 Notebook Analysis Blocks;
SCI-04 Advanced Scientific Visualisation — recorded closed. One canonical
ChartSpec and its documented Dataset/analysis/freeze limits remain authoritative.

### INT — Integrations

INT-01 Generic Connector Framework; INT-02 Scientific Instrument Ingestion;
INT-03 Enterprise/Data Platform Integrations — recorded closed. The current
contract includes a representative instrument parser and S3-compatible/read-only
PostgreSQL adapters, not every vendor/system mentioned as a future candidate.

### PLAT — Platform, Operations & Security

PLAT-01 Deployment & Environment Maturity; PLAT-02 Observability & Reliability;
PLAT-03 Security Hardening; PLAT-04 Platform Administration;
PLAT-05 Performance & Scale — recorded closed within documented deployment,
security, recovery and workload limits. Baseline CI is not fully green; later
institutional OPS tasks and off-host/populated recovery proof are not implied.

### AUTO — Automation

AUTO-01 Pipeline Foundation; AUTO-02 Deterministic Execution & Triggers;
AUTO-03 Pipeline Authoring & Product Integration; AUTO-04 Agent-authored
Operations; AUTO-05 Agentic Scientific Workflows — recorded closed. The latter
two implement bounded proposals and digest-pinned workflows over canonical
operations. They are not proof of live model-backed autonomous science.

## Further work

Do not derive assignments from the former “near-term parallelisation” section or
old task-local priority notes. Start at [`../NEXT.md`](../NEXT.md), identify the
specific unmet outcome, and preserve canonical validation, permissions,
provenance and evidence. A merged PR is not a substitute for task acceptance.
