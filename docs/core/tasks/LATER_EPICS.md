# Later Core and Automation Epics

**Status:** Intentionally not implementation-ready.

This file preserves required outcomes and constraints for later work without pretending current knowledge is sufficient to decompose distant implementation tasks safely.

At the end of the preceding epic, create a dedicated task file and promote the next epic to implementation-ready detail.

---

## CORE-04 — Records from Sheets

### Goal

Make Sheets a first-class Record registration/linking surface.

### Required outcomes

- typed Record-reference cells;
- search/link existing permitted Records;
- create a missing Record inline;
- bulk-create Records from pasted/selected rows;
- validate → preview → commit flow;
- precise row/field validation errors rendered back into the Sheet;
- duplicate/uniqueness resolution;
- required-field completion without forcing navigation to a separate registry;
- permission-aware link/create/update behaviour;
- bulk operations use controlled server contracts rather than row-at-a-time loops.

### Must preserve

Model validation, RLS, stable Record IDs, Sheet row identity and write-back semantics.

### Do not

Create a separate “registration spreadsheet” architecture. Record creation is an action of the normal compositional Sheet.

### Exit gate

A scientist can paste a realistic table, resolve existing Records, create missing Records in bulk, fix validation issues in-grid and continue working without leaving the Sheet.

---

## CORE-05 — Schema Evolution, Views and Role-aware Configuration

### Goal

Make Models/Datasets safely configurable by delegated roles.

### Required outcomes

- draft/publish/deprecate/retire lifecycle;
- safe add/rename/retire operations;
- dependency/impact discovery before breaking changes;
- historical data remains interpretable;
- Sheet-local column promotion to Dataset/Model schema where appropriate;
- saved user/team Views;
- role/capability-specific configuration controls;
- Data Steward/Model Designer authority separable from Workspace Admin;
- server enforcement, not UI-only hiding.

### Configuration UX direction

Use a dense configuration workspace: catalogue/navigation, central field/schema plane, right semantic/dependency inspector, lifecycle/impact state in header. Before breaking change, surface usage by Datasets, Sheets, Calculations and later Pipelines.

### Exit gate

A delegated Data Steward can safely evolve schema while a Scientist sees only permitted controls, and dependencies/history remain reconstructable.

---

## CORE-06 — Notebook Integration and Frozen Evidence

### Goal

Make compositional Sheets native Notebook objects with explicit live/pinned semantics and reconstructable submitted evidence.

### Required outcomes

- Notebook Sheet block references durable Sheet identity;
- explicit live versus pinned/frozen state;
- Template integration references governed definitions;
- submission/review pins the relevant structured state;
- charts/data consumers use stable Sheet/Dataset identities;
- submitted Notebook version can be reconstructed exactly;
- current revision/signature/audit architecture remains coherent.

### Exit gate

A Notebook supports live scientific work and can later produce immutable submitted evidence whose data/calculation state is reconstructable.

---

## AUTO-01 — Pipeline Foundation

### Goal

Introduce versioned typed transformations only after Model/Dataset/Sheet semantics are stable.

### Required outcomes

- Pipeline Definition separate from Pipeline Run;
- typed input/output ports and schema expectations;
- parameters;
- versioned implementation reference;
- configured transform implementation first where useful;
- SQL/Python execution boundary;
- immutable run inputs/outputs/status/log/provenance;
- Dataset outputs;
- draft/publish/run permissions;
- retries/idempotency/side-effect semantics explicitly designed.

### Do not

Start with a visual DAG editor. Do not turn Analysis Studio into a separate Pipeline engine. Do not allow arbitrary privileged SQL through the public API.

### Exit gate

A versioned transformation consumes pinned input Dataset versions and reproducibly produces a traceable output Dataset version.

---

## AUTO-02 — Agent-authored Operations

### Goal

Allow AI to propose useful transformations/configuration through normal Sheetbase contracts.

### Required outcomes

- natural-language intent becomes a structured proposed plan;
- plan validated against schemas and capabilities;
- user-visible diff/impact;
- agent-authored schema/Pipeline changes begin as drafts;
- approval policy before consequential writes where required;
- execution uses ordinary mutation/Pipeline interfaces;
- provenance records agent/model/tool context appropriate to reconstruction;
- no secret agent-only database path.

### Preferred interaction pattern

```text
intent
  → structured plan
  → permission/schema validation
  → user-visible impact
  → approval
  → normal execution
  → recorded evidence
```

### Exit gate

An agent can propose a useful data transformation, a user can inspect/approve it, and execution produces the same core evidence as a human-authored Pipeline.
