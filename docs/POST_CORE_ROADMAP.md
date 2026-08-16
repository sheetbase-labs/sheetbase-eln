# Sheetbase Post-Core Product & Platform Roadmap

> **Status:** planning reference  
> **Applies after:** CORE-01–06 and Core Hardening  
> **Current phase:** Product & Platform Consolidation  
> **Automation:** deliberately deferred until the human-facing product and platform contracts are proven

## 1. Purpose

Sheetbase now has a coherent Core Data Workspace: canonical field semantics, durable Datasets and immutable Dataset Versions, compositional Sheet Definitions and Instances, Records from Sheets, role-aware schema evolution, versioned Notebook Templates, and frozen Notebook evidence.

The next challenge is different. It is no longer primarily about inventing foundational data concepts. It is about turning those concepts into a complete, understandable, scalable product and platform.

This document is the high-level roadmap for that work.

It is intentionally broader than the user interface. Sheetbase must become all of the following:

- an excellent scientist-facing ELN and spreadsheet-like data workspace;
- a coherent data platform with stable APIs and SDKs;
- an interoperable system for files, import, export, search and integrations;
- an administrable and governable platform suitable for organisational use;
- a collaborative scientific workspace;
- a capable analysis and visualisation environment;
- an operationally reliable service;
- and, later, an automation platform for deterministic and agentic transformations.

The roadmap therefore has multiple capability tracks rather than a single linear feature list.

---

## 2. Product direction

Sheetbase should remain centred on a small number of durable concepts:

```text
Model / Field Definition
        |
      Record
        |
Dataset --- Dataset Version
        |
Sheet Definition
        |
Sheet Instance
        |
Notebook --- Notebook Template
        |
Submitted / frozen evidence
```

A scientist should not need to understand this architecture explicitly.

The product should instead feel like:

```text
Create or open a Notebook
        |
        v
Add a Sheet
        |
        +--> type/paste data immediately
        +--> link existing Samples/Records
        +--> create missing Records
        +--> add existing Datasets
        +--> add local columns
        +--> calculate
        +--> chart/analyse
        +--> promote useful structure when needed
        +--> reuse successful structures as Definitions/Templates
        |
        v
Submit / freeze when scientific work becomes evidence
```

The architecture exists to make this flexible workflow safe, scalable and governable without making the scientist perform database administration.

---

## 3. Roadmap principles

The following principles apply across all post-Core programmes.

### 3.1 Human workflows before automation

Prove the product through normal scientist and steward workflows before building broad Pipeline or agent automation.

Automation should eventually use the same validated server operations as humans and external clients, not create a parallel data model.

### 3.2 One canonical path per concept

Compatibility or legacy surfaces must not quietly become competing implementations.

Examples:

- one canonical Dataset Schema system;
- one canonical Notebook Template catalogue;
- one canonical Sheet experience;
- one public API contract over the domain;
- one capability model.

### 3.3 PostgreSQL remains authoritative

RLS, workspace isolation, durable state, versions, lifecycle, permissions, provenance and evidence remain server concerns.

Client-side affordances improve usability but are not the sole security or scientific-integrity boundary.

### 3.4 Stable identity over labels

Durable relationships use stable IDs rather than labels, visual row numbers, coordinates or generated display names.

Labels are for humans. IDs are for durable semantics.

### 3.5 Exploratory work and governed work coexist

Scientists should be able to start loosely and progressively add structure.

Local Sheet columns, local calculations and ad-hoc work remain legitimate. Promotion into governed Models, Dataset Schemas, Sheet Definitions or Templates is explicit.

### 3.6 Information density without opacity

Sheetbase should favour dense, efficient scientific workspaces, but actions, provenance, state and errors must remain understandable.

The goal is not visual minimalism at the expense of capability.

### 3.7 Historical interpretation must survive change

Later schema, Dataset, Template or Definition changes must not silently reinterpret frozen or versioned scientific evidence.

### 3.8 APIs are first-class product surfaces

The browser is one client of the Sheetbase domain, not the only client.

Python, TypeScript, integrations, Pipelines and agents should ultimately operate through the same coherent domain contracts.

---

# 4. Programme map

The post-Core roadmap is grouped into nine programmes.

| Programme | Purpose | Relative timing |
| --- | --- | --- |
| **PC — Product Consolidation** | Turn Core capabilities into one excellent scientist-facing product | Now |
| **API — API & Developer Platform** | Stable public API, credentials, SDKs, events and developer experience | Early / parallel with PC |
| **DATA — Data Interoperability** | Import, export, files, search and portability | Early / parallel with PC |
| **GOV — Identity, Administration & Governance** | Roles, organisation structure, audit, signatures and policy | Early–mid |
| **COLLAB — Collaboration** | Presence, comments, notifications and review workflows | Mid |
| **SCI — Scientific Analysis & Visualisation** | Charts, analysis and scientific result exploration | Mid, after core Sheet UX stabilises |
| **INT — Integrations** | Generic connectors, instruments and enterprise systems | Mid–late |
| **PLAT — Platform & Operations** | Deployment, reliability, observability, security and administration | Continuous; deeper hardening before scale |
| **AUTO — Automation** | Deterministic Pipelines and, later, agentic operations | Later |

These programmes are not entirely sequential. Some work should proceed in parallel once dependencies are clear.

A useful high-level shape is:

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

---

# 5. PC — Product Consolidation

## Objective

Make CORE-01–06 feel like one coherent product rather than a set of strong backend capabilities and partially overlapping screens.

The key test is simple:

> Can a scientist complete realistic work end-to-end without understanding Sheetbase's internal architecture or encountering duplicate/legacy concepts?

## PC-00 — Product & Platform Consolidation Audit

**Purpose:** establish the real post-Core starting point before committing to detailed implementation epics.

Audit the actual current product rather than the intended architecture.

### Assess

- all current routes and navigation;
- canonical versus obsolete/hidden product surfaces;
- Sheet modes and transitions;
- Dataset and Record workflows;
- Notebook block workflows;
- Template workflows;
- configuration/governance surfaces;
- import/export capabilities;
- current external API;
- API credentials;
- search;
- files;
- collaboration;
- analysis/charting;
- operational/admin surfaces;
- missing UI for already-complete Core RPCs;
- accessibility and keyboard workflows;
- realistic end-to-end golden workflows.

### Exit

A prioritised product/platform gap map and refined PC/API/DATA/GOV epics based on evidence rather than assumptions.

---

## PC-01 — Canonical Sheet Experience

**Priority:** highest product priority.

Sheet is the primary structured-data interaction surface and one of Sheetbase's key differentiators.

The experience should feel spreadsheet-native while retaining the data principles of the Core.

### Core workflow

```text
Blank Sheet
   |
   +--> type / paste
   +--> local columns and rows
   +--> formulas/calculations
   +--> add governed Dataset source
   +--> add Record reference source
   +--> local + governed data together
   +--> edit through explicit write-back targets
   +--> inspect provenance
   +--> promote useful structure
   +--> save reusable Definition
```

### Product capabilities

- immediate editable blank Sheet;
- natural row and column insertion/deletion;
- multi-cell paste;
- copy, cut and fill workflows;
- keyboard navigation and selection;
- formula entry and display;
- type-aware editors;
- clear validation feedback;
- Dataset/source binding from the Sheet;
- Record-reference columns;
- search/link/create Record interactions;
- local columns alongside governed columns;
- sorting and filtering;
- frozen columns and useful presentation controls;
- provenance inspection;
- column configuration;
- explicit local-field/calculation promotion;
- save/extract as Sheet Definition;
- Definition upgrade preview/apply;
- explicit materialisation where scientifically useful;
- understandable empty, loading, stale and conflict states;
- scalable virtualised interaction.

### UX principle

Do not force users to choose between an "ad-hoc Sheet product" and a "composed Sheet product". Those are domain states of one Sheet experience.

### Exit

A scientist can start with a blank Sheet, work freely, add governed data later, create/link Records, calculate, promote useful structure and reuse it without leaving the canonical Sheet experience.

---

## PC-02 — Dataset & Record Product Workflows

**Purpose:** make Datasets and Records useful scientific objects in their own right rather than infrastructure visible mainly through Sheets.

### Dataset capabilities

- Dataset catalogue;
- create Dataset;
- choose/create Schema;
- paste/import data;
- edit live Dataset through controlled APIs;
- browse/filter/sort/page;
- inspect Schema Version;
- create/view immutable Dataset Versions;
- compare live/current versus historical version context;
- inspect consumers/dependencies;
- open Dataset in a Sheet;
- export Dataset/Version;
- lifecycle actions.

### Record capabilities

- Model-specific registries;
- create/edit Record;
- relationships;
- bulk Record creation;
- identifiers;
- custom fields;
- Dataset/Sheet usage visibility;
- dependency/history view;
- lifecycle actions;
- links into related scientific work.

### Exit

Users can understand and manage durable structured data without needing to enter through a Notebook first.

---

## PC-03 — Notebook Experience

**Purpose:** make the Notebook the clear scientific-context container around Sheets, Records, files, narrative and evidence.

### Capabilities

- fast Notebook creation;
- high-quality rich-text editing;
- block insertion;
- block reorder and navigation;
- multiple Sheet blocks;
- Record and Dataset references;
- files/images;
- clear block menus and keyboard shortcuts;
- duplicate/copy workflows;
- Notebook metadata;
- revisions/history;
- working versus submitted state;
- submission/review/signature experience;
- frozen historical rendering;
- amendment/reopen pathways where permitted;
- print/export/evidence presentation.

### Exit

A normal scientific experiment can be authored, worked, reviewed, submitted and revisited historically without exposing internal persistence concepts.

---

## PC-04 — Templates & Reusable Science

**Purpose:** productise the reusable configuration capabilities built in CORE-03 and CORE-06.

### Notebook Template builder

- stable Template identity;
- draft/published versions;
- narrative placements;
- multiple Sheet Definition placements;
- same Definition reusable multiple times;
- parameter definitions;
- typed mappings into Sheet parameters;
- preview;
- version history;
- publish/retire;
- instantiate;
- explicit upgrade;
- dependency inspection.

### Sheet Definition catalogue

- find/browse Definitions;
- understand versions;
- understand dependencies;
- create from successful Instance structure;
- edit draft versions;
- publish;
- retire;
- upgrade consumers explicitly.

### Exit

A Data Steward can encode a repeatable scientific workflow without copying live data or creating hidden shared state.

---

## PC-05 — Configuration & Steward Workspace

**Purpose:** turn `/configure` into the canonical organisational configuration plane.

### Surfaces

- Models;
- Model fields;
- Dataset Schemas;
- Schema Versions;
- Sheet Definitions;
- Notebook Templates;
- controlled vocabularies;
- dependencies;
- lifecycle;
- impact analysis;
- promotion/evolution review;
- role/capability visibility.

### Design direction

Prefer a dense, immersive schema workspace over disconnected admin forms.

Configuration should make relationships visible:

```text
Model: Sample
  |
  +-- Identifier
  +-- Generation
  +-- Inventor
  +-- Vector type
  |
  +--> used by Dataset Schemas
  +--> used by Sheet Definitions
  +--> referenced by Templates
```

### Exit

A Steward can understand, evolve and govern the data language of a workspace without becoming a general workspace administrator.

---

## PC-06 — Golden Workflow Consolidation

**Purpose:** stop adding broad features temporarily and make representative workflows excellent.

Candidate golden workflows:

1. **Simple assay Notebook** — Samples + entered measurements + calculations + submission.
2. **Purification experiment** — multiple Datasets + Sample Records + local observations + recovery calculations.
3. **Batch/Sample registration** — paste → resolve/create Records → governed Dataset.
4. **Exploratory to governed** — ad-hoc Sheet → Dataset binding → local analysis → promotion → reusable Definition.
5. **Reusable Notebook Template** — narrative + multiple Sheet Definitions + typed parameters → independent Notebooks.
6. **Submitted evidence** — freeze → mutate live state → historical render unchanged.

### Exit

Each workflow is understandable, efficient and free of architectural dead ends, duplicate paths or unexplained state transitions.

---

# 6. API — API & Developer Platform

## Objective

Make Sheetbase programmable through a deliberate public domain API rather than exposing database implementation details as the de facto integration contract.

PostgREST and RPCs remain useful implementation infrastructure, but the public contract must be stable, documented and understandable.

---

## API-01 — Public API Contract

### Define public resources

Likely domains include:

```text
/api/v1/models
/api/v1/records
/api/v1/dataset-schemas
/api/v1/datasets
/api/v1/datasets/{id}/rows
/api/v1/dataset-versions
/api/v1/sheet-definitions
/api/v1/sheet-instances
/api/v1/notebooks
/api/v1/notebook-templates
/api/v1/files
```

Exact REST shape should be decided from actual use cases, not by mirroring SQL table names.

### Contract requirements

- versioning policy;
- resource identity;
- pagination;
- filtering;
- sorting;
- sparse field selection where useful;
- bulk operations;
- structured validation errors;
- stable error codes;
- optimistic concurrency;
- idempotency keys;
- retry semantics;
- rate limits;
- lifecycle representation;
- version/snapshot access;
- capability/permission errors;
- backwards-compatibility and deprecation policy.

### Principle

Browser and public API should exercise the same server-side domain operations wherever practical.

### Exit

External clients can perform supported scientific workflows without depending on internal table/RPC names.

---

## API-02 — API Credentials & Service Identity

### Capabilities

- personal API tokens;
- scoped service accounts;
- workspace binding;
- capability scopes;
- expiry;
- rotation;
- revocation;
- last-used metadata;
- credential audit;
- safe secret display/storage;
- request attribution.

Later, consider OAuth2/OIDC for third-party applications when there is a concrete ecosystem need.

### Exit

External automation can authenticate safely without borrowing human browser sessions or broad database credentials.

---

## API-03 — OpenAPI & Documentation

### Deliver

- authoritative OpenAPI document;
- versioned API docs;
- examples;
- error reference;
- pagination/filter reference;
- idempotency/retry guidance;
- authentication guide;
- migration/deprecation notes;
- runnable examples.

OpenAPI should be generated from or validated against the implementation where possible to reduce drift.

### Exit

A competent developer can integrate with Sheetbase without reading application source.

---

## API-04 — Python SDK

Python is strategically important because scientific users already work in pandas, notebooks and analysis pipelines.

### Desired ergonomics

```python
sb = Sheetbase(...)

dataset = sb.datasets.get("...")
df = dataset.to_pandas()

sample = sb.records.create(
    model="sample",
    values={"name": "LVV-001", "generation": 3},
)

dataset.rows.create({
    "sample": sample.id,
    "titre": 8.4e8,
})
```

### SDK responsibilities

- typed resources;
- authentication;
- pagination iterators;
- pandas conversion;
- bulk upload/download;
- idempotent mutation helpers;
- exceptions mapped from stable API errors;
- version compatibility;
- optional async support where useful.

### Exit

Scientific Python users can use Sheetbase as a normal data platform without hand-writing HTTP calls.

---

## API-05 — TypeScript SDK

Useful for internal/external web applications and integrations.

The SDK should derive from the same public contract as Python rather than becoming a separate semantic implementation.

---

## API-06 — Events & Webhooks

### Candidate event types

```text
record.created
record.updated
dataset.created
dataset.updated
dataset.version.created
schema.published
sheet.materialised
notebook.submitted
notebook.amended
template.published
```

### Requirements

- subscriptions;
- signed payloads;
- durable delivery attempts;
- retries/backoff;
- replay;
- delivery history;
- idempotent consumer guidance;
- event versioning;
- workspace isolation;
- secret rotation.

### Exit

External systems can respond reliably to Sheetbase changes without polling.

---

# 7. DATA — Data Interoperability

## Objective

Make it straightforward to get scientific data into and out of Sheetbase while retaining typing, provenance and validation.

---

## DATA-01 — Import Framework

### Inputs

- clipboard;
- CSV;
- TSV;
- XLSX;
- JSON;
- later: Parquet and instrument-specific formats.

### Workflow

```text
Choose source
    |
Preview
    |
Map columns
    |
Infer / select types
    |
Resolve Records
    |
Validate
    |
Show row-level errors
    |
Commit atomically / according to explicit batch policy
```

### Requirements

- mapping templates;
- type inference without silent coercion;
- required/default handling;
- vocabulary matching;
- Record lookup/create;
- quantity/unit handling consistent with existing semantics;
- preview before commit;
- downloadable rejected rows;
- provenance of source file/import;
- large-file streaming/chunking;
- retry/idempotency.

### Exit

A scientist can import common tabular data safely without manually restructuring it first.

---

## DATA-02 — Export & Portability

### Export objects

- Dataset;
- Dataset Version;
- Sheet;
- Notebook;
- Notebook submission/evidence;
- Records;
- audit/change history where authorised.

### Formats

- CSV;
- XLSX;
- JSON;
- Parquet;
- PDF/evidence package where appropriate.

### Principles

- exported immutable versions must identify what was exported;
- machine-readable formats should preserve stable IDs and schema metadata where useful;
- human-readable exports should remain understandable outside Sheetbase.

---

## DATA-03 — File & Object Storage

Files are a first-class scientific need even though they are not the same as structured Datasets.

### Capabilities

- upload/download;
- object storage backend;
- immutable file versions where required;
- checksums;
- MIME/type metadata;
- image/PDF preview;
- Notebook attachments;
- Record attachments;
- Dataset attachments;
- provenance links;
- retention/lifecycle;
- duplicate detection where appropriate;
- malware/virus scanning;
- size/usage limits;
- evidence pinning.

### Exit

Scientific files can be used and referenced safely without becoming opaque external URLs.

---

## DATA-04 — Global Search

### Search across

- Records;
- Datasets;
- Notebooks;
- Templates;
- Sheet Definitions;
- files;
- configuration objects;
- eventually selected structured values where appropriate.

### Product experience

A command/search surface should answer queries such as:

```text
Sample-1023
Purification run 48
Benzonase
LVV titre
Notebook submitted last week
```

### Implementation direction

Start with PostgreSQL search/indexing if sufficient. Do not introduce an external search platform before scale/relevance requirements justify it.

---

# 8. GOV — Identity, Administration & Governance

## Objective

Evolve the Core capability model into a comprehensible organisational governance product.

---

## GOV-01 — Role & Permission Management

CORE-05 intentionally established a small role-mapped capability system rather than a full RBAC designer.

Productise it before making it substantially more complex.

### Capabilities

- visible role definitions;
- assign/remove members;
- clear permission summaries;
- owner/admin/steward/scientist/viewer semantics;
- correct the current `viewer` mismatch when ready;
- permission preview;
- server-authoritative checks;
- audit of permission changes.

Custom roles or per-user grants should be introduced only if real use cases require them.

---

## GOV-02 — Organisation Model

The Core is currently workspace-scoped by design.

A real deployment may need:

```text
Organisation
   |
   +-- Workspaces
   +-- Members
   +-- organisational roles
   +-- shared Models
   +-- vocabularies
   +-- policy/configuration
   +-- billing/usage context
```

### Questions to resolve

- which configuration belongs to organisation versus workspace;
- inheritance/override policy;
- cross-workspace Record/Data visibility;
- organisation membership lifecycle;
- tenant isolation;
- migration from current workspace ownership.

This should be an explicit architecture programme, not an incidental schema edit.

---

## GOV-03 — Audit & Change History Product

The Core stores provenance/events, but users need a usable inspection experience.

### Deliver

- object activity timeline;
- who changed what and when;
- before/after where meaningful;
- provenance source;
- schema/version history;
- filters;
- export;
- links from Sheet cells/Records/Datasets to relevant history;
- clear distinction between audit log and immutable scientific version.

---

## GOV-04 — Review, Electronic Records & Signatures

CORE-06 provides the technical base for revisions, submission, lock/amend and signatures.

Mature this into an explicit product capability.

### Areas

- review state;
- approval/rejection;
- signature meanings;
- re-authentication;
- signing reason;
- signature manifestation;
- controlled reopening/amendment;
- evidence-package export;
- policy configuration;
- retained historical interpretation.

For regulated deployments, assess requirements against applicable Part 11 / Annex 11 / GxP expectations rather than assuming generic e-signature behaviour is sufficient.

---

## GOV-05 — Retention, Archival & Policy

Later organisational deployments may require:

- retention periods;
- legal/quality holds;
- archive policies;
- deletion review;
- export before deletion;
- storage-tier movement;
- policy audit.

Keep destructive deletion dependency-aware and evidence-safe.

---

# 9. COLLAB — Collaboration

## Objective

Enable teams to work together without turning Sheetbase into a generic project-management product.

---

## COLLAB-01 — Presence & Concurrent Work

Start pragmatically.

Potential capabilities:

- who is viewing;
- who is editing;
- live refresh;
- clear stale/conflict messages;
- optimistic concurrency UX;
- optional cell/block presence later.

Do not introduce CRDT complexity until actual simultaneous-authoring requirements justify it.

---

## COLLAB-02 — Comments & Mentions

Comments may attach to:

- Notebook blocks;
- Sheet cells/ranges;
- Records;
- Datasets;
- configuration proposals.

Requirements:

- mentions;
- threads;
- resolve/reopen;
- permissions;
- durable stable target references;
- notification integration;
- history.

---

## COLLAB-03 — Notifications

### Candidate notifications

- mention;
- Notebook ready for review;
- review completed/rejected;
- schema change awaiting action;
- import failed;
- Template upgrade available;
- webhook/integration failure;
- storage/administrative alerts.

Start with in-app notifications and email where useful.

---

## COLLAB-04 — Lightweight Review Tasks

Support scientific work transitions such as:

```text
Draft -> Ready for review -> Reviewed / Changes requested -> Submitted
```

Avoid becoming a general task tracker. Integrate with specialist task systems if teams need richer project management.

---

# 10. SCI — Scientific Analysis & Visualisation

## Objective

Make Sheetbase useful not only for recording structured data but also for understanding it.

This programme should build on the canonical Sheet/Dataset model rather than reintroduce a separate scientific-table analysis architecture.

---

## SCI-01 — Charting

### Initial chart families

- scatter;
- line;
- bar;
- histogram;
- box plot;
- heatmap where appropriate.

### Required scientific features

- grouping;
- colour/series mapping;
- faceting;
- log axes;
- error bars;
- reference lines;
- annotations;
- axis formatting;
- units;
- filtering;
- aggregation;
- reproducible chart configuration;
- SVG/PNG export;
- Notebook embedding.

Charts should reference stable Sheet/Dataset fields and configuration rather than copying opaque data blobs.

---

## SCI-02 — Analysis Operations

Start with broadly useful analysis rather than domain-specific modules.

Potential early operations:

- descriptive statistics;
- grouping and aggregation;
- transformations;
- regression;
- basic curve fitting;
- normalisation;
- outlier/flag workflows where scientifically justified.

Operations should retain provenance and clear input identity.

Do not turn this into Pipeline infrastructure prematurely.

---

## SCI-03 — Analysis & Chart Blocks

Support Notebook flows such as:

```text
Sheet
  |
Analysis
  |
Chart
  |
Narrative interpretation
```

Analysis and chart blocks should remain linked to exact inputs/configuration and behave predictably when working data changes versus when evidence is submitted.

---

## SCI-04 — Specialist Scientific Modules

Only after generic analysis workflows are strong, consider domain modules such as:

- plate layouts;
- assay curves;
- QC views;
- sample lineage;
- process trends;
- inventory/freezer views;
- instrument-specific analysis.

These should compose Core primitives rather than create separate data silos.

---

# 11. INT — Integrations

## Objective

Let Sheetbase exchange data with scientific instruments and enterprise systems through a consistent integration framework.

---

## INT-01 — Generic Connector Framework

Before individual integrations, establish common concepts:

- Connector Definition;
- credentials/secrets;
- inbound/outbound direction;
- mapping;
- polling/schedule/event trigger;
- execution/run history;
- errors/retries;
- provenance;
- idempotency;
- lifecycle;
- health/status.

Do not build a full Pipeline engine merely to support connectors.

---

## INT-02 — Scientific Instrument Ingestion

Candidate integrations should be chosen from actual users and workflows.

Possible examples:

- QuantStudio;
- SpectraMax;
- plate readers;
- Octet;
- sequencing outputs;
- balances;
- liquid handlers;
- chromatography/process equipment.

Typical pattern:

```text
Instrument file/result
        |
Parse + validate
        |
Map metadata / Records
        |
Dataset
        |
Sheet / Notebook
```

Instrument-specific parsers should feed generic Dataset/Record contracts.

---

## INT-03 — Enterprise Data Systems

Potential integrations include:

- S3-compatible storage;
- SharePoint/OneDrive;
- LIMS;
- MES;
- ERP;
- data warehouses/lakehouses;
- Snowflake/Databricks;
- identity providers;
- messaging/notification systems.

Build concrete integrations only where there is a real deployment need.

---

# 12. PLAT — Platform, Operations & Security

## Objective

Make Sheetbase reliable and supportable as a real service, not merely correct in development.

This is partly continuous work and partly a dedicated hardening programme before broader deployment.

---

## PLAT-01 — Deployment & Environments

### Deliver

- reproducible deployment artifacts;
- dev/test/staging/prod separation;
- environment configuration;
- database migration orchestration;
- rollback/recovery procedures;
- feature flags where justified;
- managed secrets;
- deployment health checks.

---

## PLAT-02 — Observability

### Requirements

- structured application logs;
- request IDs;
- database/RPC observability;
- metrics;
- traces where useful;
- error reporting;
- background-job visibility;
- webhook/integration health;
- audit versus operational log separation;
- dashboards and alerts.

---

## PLAT-03 — Backup, Restore & Disaster Recovery

### Deliver

- automated database backup;
- object-storage backup strategy;
- restore drills;
- recovery-point and recovery-time targets;
- point-in-time recovery where appropriate;
- evidence that backups are usable, not merely configured.

---

## PLAT-04 — Security Hardening

### Areas

- secret handling;
- session security;
- CSP;
- CSRF/XSS protections;
- rate limiting;
- API abuse controls;
- dependency scanning;
- SAST;
- container/image scanning if deployed that way;
- RLS regression tests;
- privilege review;
- penetration testing;
- security headers;
- malware scanning for file uploads;
- vulnerability-response process.

---

## PLAT-05 — Performance & Scale

Scale work should be driven by representative product workloads.

### Measure

- 100k+ row Dataset interaction;
- large Sheet paste;
- composed multi-Dataset Sheet queries;
- grid rendering;
- Notebook load;
- Template instantiation;
- submission/freeze;
- import/export;
- concurrent users;
- search;
- large file operations.

### Principles

- optimise measured bottlenecks;
- keep canonical semantics intact;
- avoid premature distributed architecture;
- establish budgets for common interactions.

---

## PLAT-06 — Administration & Usage

Potential administrative surfaces:

- members;
- workspaces;
- storage usage;
- API usage;
- integration health;
- audit access;
- environment/version information;
- feature availability;
- limits/quotas;
- support diagnostics.

---

# 13. AUTO — Automation

## Objective

Automation should come after the human-facing product, API contracts and data platform have been exercised sufficiently to know which operations are stable and valuable.

The automation layer should reuse Core identity, permissions, versions and provenance.

---

## AUTO-01 — Deterministic Pipeline Foundation

**Status:** deferred.

### Core model

```text
immutable Dataset Version(s)
          |
          v
versioned Pipeline Definition
          |
          v
Pipeline Run
          |
          v
Dataset / Dataset Version output
```

### Requirements

- typed parameters;
- immutable/reproducible inputs;
- versioned transformation definition;
- explicit execution environment;
- SQL/Python boundaries;
- deterministic configured transforms where possible;
- output identity;
- retries;
- run status;
- logs;
- provenance;
- permissions;
- cancellation;
- failure semantics;
- code/config version references.

Do not begin with a visual DAG builder.

---

## AUTO-02 — Pipeline Product Integration

### Product capabilities

- create/configure Pipeline;
- select inputs;
- parameterise;
- run manually;
- inspect run history;
- inspect outputs;
- attach outputs to Sheet/Notebook;
- compare runs;
- reuse definitions.

Scheduling/event-driven execution should follow once the execution contract is stable.

---

## AUTO-03 — Scheduled & Event-driven Execution

Potential triggers:

- schedule;
- Dataset Version created;
- Notebook submitted;
- external webhook;
- integration event.

Triggers must not weaken idempotency or evidence requirements.

---

## AUTO-04 — Agent-authored Operations

Agents should propose changes through ordinary platform operations.

Examples:

- propose a Dataset Schema change;
- add a calculated field;
- build a Sheet Definition;
- configure a Pipeline;
- map an import;
- summarise data;
- propose analysis.

The user should be able to inspect what will happen before consequential changes execute.

---

## AUTO-05 — Agentic Scientific Workflows

Longer-term, agents may coordinate multi-step work.

The governing principle remains:

```text
Agent
  |
read authorised state
  |
propose normal domain operation
  |
server validation + permission
  |
preview / approval where required
  |
commit
  |
normal provenance / audit / versioning
```

There should be no privileged "AI bypass" around normal Sheetbase contracts.

---

# 14. Recommended sequencing

The roadmap is broad, but not everything should start at once.

## Phase A — Consolidate the human product and define the platform contract

**Start now:**

1. PC-00 Product & Platform Consolidation Audit
2. PC-01 Canonical Sheet Experience
3. API-01 Public API Contract
4. DATA-01 Import Framework discovery/design
5. DATA-03 File/storage assessment
6. PLAT baseline review for deployment/security/observability

Rationale: Sheet, API and import workflows expose whether Core semantics are genuinely usable.

## Phase B — Make the common scientific workspace complete

Then prioritise:

- PC-02 Dataset & Record workflows;
- PC-03 Notebook experience;
- PC-04 Templates;
- PC-05 Configuration;
- API credentials + OpenAPI;
- Python SDK;
- export;
- files;
- search;
- first governance product surfaces.

## Phase C — Team and scientific capability

Once common workflows are coherent:

- collaboration;
- review/signature UX maturation;
- charts;
- analysis;
- organisation model if required by deployments;
- richer platform hardening;
- generic connector framework.

## Phase D — Integrations and deployment maturity

Then:

- selected instrument integrations;
- enterprise integrations;
- deeper performance/concurrency work;
- operational administration;
- compliance-oriented deployment controls where needed.

## Phase E — Automation

Only after the preceding platform contracts are stable:

- AUTO-01 deterministic Pipelines;
- AUTO-02 product integration;
- AUTO-03 triggers/scheduling;
- AUTO-04 agent-authored operations;
- AUTO-05 agentic workflows.

---

# 15. Cross-cutting acceptance themes

Every epic should consider these rather than treating them as late-stage cleanup.

## Accessibility

- keyboard operation;
- focus visibility;
- semantic controls;
- accessible names;
- screen-reader-compatible structure where practical;
- colour not used as the sole state indicator;
- clear validation and error association;
- reduced-motion consideration;
- large dense grids remain operable without mouse-only interactions.

## Performance

- define representative workload;
- measure before optimising;
- avoid UI patterns that require fetching entire large Datasets;
- preserve paging/virtualisation;
- keep expensive analysis explicit.

## Security

- RLS authoritative;
- least privilege;
- stable capability checks;
- workspace isolation;
- no browser-only security controls;
- consequential APIs tested for denied cases.

## Provenance

For mutations and derived output, users should be able to answer:

- where did this value come from?
- who/what changed it?
- when?
- through which operation?
- which source/version was used?

## Versioning

Do not version everything continuously. Version when the product needs an immutable scientific/configuration boundary.

## Error design

Errors must be actionable:

- identify object/row/field;
- explain validation failure;
- distinguish stale/conflict/permission/system failure;
- retain user work where possible;
- offer safe retry where supported.

## Testing

Prefer vertical workflow tests that cross DB/RLS/API/UI boundaries, plus focused unit tests for complicated domain semantics.

---

# 16. What is deliberately deferred

The roadmap should resist attractive but premature complexity.

Do not prioritise the following without evidence from product use:

- full visual Pipeline/DAG designer;
- fully custom per-user RBAC grants;
- generic low-code application builder;
- arbitrary Template/Definition inheritance;
- distributed event architecture;
- CRDT-based collaborative editing;
- separate search infrastructure before PostgreSQL is insufficient;
- general-purpose workflow/project-management system;
- automatic AI mutations that bypass preview/approval;
- broad domain-specific assay/instrument modules before generic Sheet/Dataset workflows are strong;
- a general saved View subsystem until use cases prove the abstraction is needed.

---

# 17. Proposed roadmap identifiers

Use these prefixes for future planning documents and issues:

| Prefix | Programme |
| --- | --- |
| `PC-*` | Product Consolidation |
| `API-*` | API & Developer Platform |
| `DATA-*` | Data Interoperability |
| `GOV-*` | Identity, Administration & Governance |
| `COLLAB-*` | Collaboration |
| `SCI-*` | Scientific Analysis & Visualisation |
| `INT-*` | Integrations |
| `PLAT-*` | Platform / Operations / Security |
| `AUTO-*` | Automation |

These are planning identifiers, not a requirement to start every epic or create all task files immediately.

---

# 18. Immediate next step

Do **not** immediately turn every section in this document into implementation tickets.

The immediate next task should be **PC-00 — Product & Platform Consolidation Audit**.

PC-00 should inspect the current `main` implementation and answer:

1. What user-facing surfaces exist today?
2. Which use canonical Core objects?
3. Which capabilities exist only as RPC/API and have no usable product surface?
4. Which screens duplicate or contradict one another?
5. What external API actually exists today?
6. What API credential model exists today?
7. What import/export support exists?
8. What file/storage support exists?
9. What search exists?
10. What collaboration exists?
11. What governance/admin experience exists?
12. What charting/analysis exists?
13. What integration framework exists?
14. What operational/security platform capabilities exist?
15. Which of the proposed epics should be split, combined, deferred or reordered based on actual code?
16. What are the highest-value end-to-end workflows that fail or feel incomplete today?

The output should refine this roadmap into the first implementation programme without reopening completed Core architecture.

---

# 19. Definition of post-Core success

Before Sheetbase enters heavy automation work, the platform should broadly satisfy the following:

### Scientist

A scientist can create a Notebook, work naturally in Sheets, paste/import data, use Records and Datasets, calculate and chart, attach files, reuse Templates, collaborate/review, and submit durable evidence.

### Data Steward

A Steward can define Models, schemas, vocabularies, Sheet Definitions and Templates; understand dependencies; evolve configuration safely; and support scientists without general workspace administration.

### Developer / integrator

A developer can authenticate through supported credentials, use documented stable APIs/SDKs, import/export data and respond to events without depending on private database implementation details.

### Administrator

An administrator can manage users/workspaces, understand permissions and usage, inspect audit/security state, back up and restore the service, and operate it safely.

### Scientific evidence

Historical evidence remains reconstructable and interpretable after live data/configuration changes.

### Automation readiness

The operations above expose stable typed contracts, identity, versioning, permissions, provenance, idempotency and events sufficient for deterministic Pipelines and agents to use the same platform safely.

That is the point at which broad automation becomes an accelerator rather than a source of architectural churn.
