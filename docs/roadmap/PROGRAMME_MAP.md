# Sheetbase Post-Core Programme Map

## Overview

Post-Core work is organised as capability programmes rather than one enormous sequential feature list.

| Programme | Objective | Timing |
| --- | --- | --- |
| **PC** | Turn Core capabilities into one coherent scientist-facing product | Now |
| **API** | Stable public API, credentials, SDKs, webhooks and developer experience | Early / parallel |
| **DATA** | Import, export, files, search and portability | Early / parallel |
| **GOV** | Roles, organisation structure, audit, signatures and policy | Early–mid |
| **COLLAB** | Presence, comments, notifications and review workflows | Mid |
| **SCI** | Charts, analysis and scientific exploration | Mid |
| **INT** | Generic connectors, instruments and enterprise systems | Mid–late |
| **PLAT** | Deployment, reliability, observability, security and administration | Continuous |
| **AUTO** | Deterministic Pipelines and later agentic operations | Later |

## Dependency shape

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
                     v        v
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

This diagram communicates likely sequencing and dependencies, not a strict waterfall. Streams can overlap when their concrete prerequisites are available. AUTO is simply a later workstream, in the same way that INT is generally later than API/DATA and SCI follows the core Sheet experience.

## Proposed epics

### PC — Product Consolidation

- `PC-00` Product & Platform Consolidation Audit (complete — `audits/PC-00.md`)
- `PC-01` Canonical Sheet Experience (Ready, medium; includes Notebook enabling slice)
- `PC-02` Dataset & Record Product Workflows
- `PC-03` Notebook Experience
- `PC-04` Templates & Reusable Science
- `PC-05` Configuration & Steward Workspace
- `PC-06` Golden Workflow Consolidation

### API — API & Developer Platform

- `API-01` Public API Contract (Ready, low, parallel)
- `API-02` API Credentials & Service Identity
- `API-03` OpenAPI & Documentation
- `API-04` Python SDK
- `API-05` TypeScript SDK
- `API-06` Webhooks & Event Delivery

### DATA — Data Interoperability

- `DATA-01` Import Framework
- `DATA-02` Export & Portability
- `DATA-03` File & Attachment Platform
- `DATA-04` Global Search

### GOV — Identity, Administration & Governance

- `GOV-01` Role & Capability Productisation (Queued; `viewer` = read-only)
- `GOV-02` Organisation Model
- `GOV-03` Audit & History Experience
- `GOV-04` Electronic Records, Review & Signatures

### COLLAB — Collaboration

- `COLLAB-01` Presence & Concurrent Awareness
- `COLLAB-02` Comments, Mentions & Resolution
- `COLLAB-03` Notifications
- `COLLAB-04` Lightweight Review & Tasks

### SCI — Scientific Analysis & Visualisation

- `SCI-01` Charting
- `SCI-02` Analysis Framework
- `SCI-03` Notebook Analysis Blocks
- `SCI-04` Advanced Scientific Visualisation

### INT — Integrations

- `INT-01` Generic Connector Framework
- `INT-02` Scientific Instrument Ingestion
- `INT-03` Enterprise/Data Platform Integrations

### PLAT — Platform, Operations & Security

- `PLAT-01` Deployment & Environment Maturity
- `PLAT-02` Observability & Reliability
- `PLAT-03` Security Hardening (Queued, low initially)
- `PLAT-04` Platform Administration
- `PLAT-05` Performance & Scale

### AUTO — Automation

- `AUTO-01` Pipeline Foundation
- `AUTO-02` Deterministic Execution & Triggers
- `AUTO-03` Pipeline Authoring & Product Integration
- `AUTO-04` Agent-authored Operations
- `AUTO-05` Agentic Scientific Workflows

## Suggested near-term parallelisation

PC-00 is complete (`audits/PC-00.md`) and **accepted**. Delivery priority is only **medium** or **low**. Agents take one assigned stream from `NEXT.md`.

```text
medium  PC-01  merge-ready #41 (do not merge unless instructed)
low     API-01 merge-ready #40 (do not merge unless instructed)
medium  PC-02  Dataset & Record product workflows (from current main)
low     PLAT-03 security-headers slice (from current main)
queued  GOV-01 viewer = read-only (Medium when started; RLS/migration)
wait    DATA-01 until PC-01 is on main
wait    API-02 until API-01 is on main
```

Do not activate COLLAB, SCI, INT or AUTO from this hand-off.

## Later streams

Later programmes should begin when the specific capabilities they depend on are available; they do not require a special programme-wide readiness ceremony.

For AUTO this will naturally mean building on mature enough Dataset/API/service-identity/provenance/execution capabilities. For INT it means building on the connector/data/API foundations relevant to the integration. For SCI it means building on stable Sheet/Dataset semantics.

All streams should reuse the same governed Sheetbase domain operations rather than bypassing validation, permissions or provenance.
