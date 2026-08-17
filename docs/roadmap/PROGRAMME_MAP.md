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
              \             |      /
               +------------+-----+
                            |
                            v
                           AUTO
```

This diagram communicates dependencies, not a strict waterfall.

## Proposed epics

### PC — Product Consolidation

- `PC-00` Product & Platform Consolidation Audit
- `PC-01` Canonical Sheet Experience
- `PC-02` Dataset & Record Product Workflows
- `PC-03` Notebook Experience
- `PC-04` Templates & Reusable Science
- `PC-05` Configuration & Steward Workspace
- `PC-06` Golden Workflow Consolidation

### API — API & Developer Platform

- `API-01` Public API Contract
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

- `GOV-01` Role & Capability Productisation
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
- `PLAT-03` Security Hardening
- `PLAT-04` Platform Administration
- `PLAT-05` Performance & Scale

### AUTO — Automation

- `AUTO-01` Deterministic Pipeline Foundation
- `AUTO-02` Pipeline Execution & Triggers
- `AUTO-03` Pipeline Authoring & Product Integration
- `AUTO-04` Agent-authored Operations
- `AUTO-05` Agentic Scientific Workflows

## Suggested near-term parallelisation

PC-00 should happen first because it establishes the real current state. After its findings are accepted, a likely early parallel shape is:

```text
PC-01  Canonical Sheet UX
API-01 Public API contract
DATA-01 Import framework
PLAT-02 Observability/reliability gaps
```

This is provisional. PC-00 owns refinement.

## Automation readiness gate

Do not start broad AUTO work merely because the Core can technically support it.

Automation becomes appropriate when:

- canonical human workflows are coherent;
- public domain operations are stable;
- service identity exists;
- import/export and evidence semantics are mature;
- operational observability is sufficient to diagnose failed automation;
- permissions and provenance are consistent across UI/API;
- deterministic transformation semantics are well understood.

Agents should later use the same governed operations as humans and deterministic Pipelines rather than bypassing validation, permissions or provenance.
