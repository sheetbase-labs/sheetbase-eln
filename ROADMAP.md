# Sheetbase roadmap

> **Active programme:** Core Data Workspace.  
> **Canonical:** `docs/core/` and accepted ADRs 0020–0024.

## Destination

Sheetbase is a scientific data workspace where the Notebook provides scientific context and Excel-like Sheet Instances provide the primary structured-data interaction surface while PostgreSQL remains authoritative.

Reusable organisational configuration (Models, Dataset Schemas, Sheet Definitions, Notebook Templates, vocabularies) is separate from project/workspace scientific working state (Records, Datasets, Notebooks, Sheet Instances).

A Sheet Instance can compose multiple Datasets and Model Records with local and calculated columns. Every value has provenance and every writable value has one authoritative write target.

## Active epics

### CORE-01 — Common Schema Kernel

Unify semantic Field Definition identity/types/units/validation/vocabulary/relationships/lifecycle across Models and Dataset Schemas while preserving the existing Model framework.

**Exit:** Models and future Dataset Schemas consume one coherent semantic field language and schema authority is distinct from ordinary Record editing.

### CORE-02 — Dataset Primitive and Versioning

Make Dataset durable rectangular data independent of Sheet presentation.

Deliver Dataset/Dataset Schema identity, explicit Schema versions, stable rows/fields, live mutable state plus meaningful immutable Dataset Versions, PostgreSQL storage/RLS/API, bulk validation/write and representative performance evidence.

**Exit:** a Dataset exists independently, is API-addressable and bulk-writable, and can produce an immutable version suitable for frozen evidence/Pipeline input.

### CORE-03 — Sheet Definition and Compositional Sheet Instance

Implement separate reusable versioned Sheet Definitions and working Sheet Instances.

Deliver typed parameters/binding contracts, multiple Dataset/Model sources, explicit row identity/joins, bound/local/calculated columns, durable Instance-local values, explicit write-back, calculation scopes, persisted presentation state, save-Instance-as-Definition and explicit data-preserving Definition upgrades.

Composition remains virtual unless explicitly materialised.

**Exit:** one reusable Definition can create independent Instances; an Instance combines at least two Datasets plus a Model and local/calculated columns with correct provenance/write-back; Definition changes do not silently mutate existing work.

### CORE-04 — Records from Sheets

Make Sheet Instances first-class Record linking/registration surfaces.

Deliver typed Record references, existing-Record search/link, inline creation, validated bulk creation from pasted/selected rows, duplicate/uniqueness handling and permission-aware operations.

**Exit:** a scientist can paste realistic data, resolve/create Records and continue without leaving the Sheet.

### CORE-05 — Schema Evolution and Role-aware Configuration

Make configuration safely delegable.

Deliver schema lifecycle/version impact handling, safe field evolution, local-field/calculation promotion, capability-based configuration and dependency inspection. Persist Sheet presentation state; named saved Views are optional future enhancement rather than a Core requirement.

**Exit:** a Data Steward can evolve governed definitions safely while Scientists see only permitted configuration and historical semantics remain interpretable.

### CORE-06 — Notebook Templates, Sharing and Frozen Evidence

Make Sheet Instances native Notebook objects and Notebook Templates reusable organisational composition.

Deliver pinned Sheet Definition references, normal independent instantiation, explicit shared-live Instance references, explicit snapshots, Template parameter flow, archive/retire/dependency behaviour, and submitted evidence that reconstructs Dataset Versions, semantic manifests, Definition versions, Instance-local state and calculations.

No Template inheritance; future repeated content uses explicit reusable Sections if needed.

**Exit:** multiple Templates can reuse one Definition safely, shared live work is obvious, and submitted Notebooks reconstruct exact structured evidence.

### AUTO-01 — Pipeline Foundation

Introduce broader typed transformations after the Core data substrate is stable.

Deliver shared typed parameters, versioned Pipeline Definitions/Runs, immutable inputs, configured transforms, SQL/Python execution boundary, Dataset outputs and run provenance.

**Exit:** a versioned transformation consumes immutable input Dataset Versions and reproducibly produces traceable output Dataset state.

### AUTO-02 — Agent-authored Operations

Allow agents to propose governed schema/Definition/Pipeline operations through normal platform contracts.

**Exit:** users can inspect/approve agent-authored changes and execution produces the same evidence as human/code-authored operations.

## Golden workflow

Use a Lentivector purification Notebook throughout:

```text
Organisation configuration
  Model: Sample
  Dataset Schemas: Upstream Results, Purification Results
  Sheet Definition: Purification Summary

Project working state
  Upstream Dataset
  Purification Dataset
  Notebook
    `-- Sheet Instance
          +-- Sample Records
          +-- both Datasets
          +-- local Observation
          `-- calculated Recovery
```

The completed Core proves data paste, Record linking/creation, explicit row identity/joins, correct write-back, durable local values, calculation, reload, presentation state, provenance, Definition reuse, explicit materialisation and frozen submission evidence.

## Sequencing

1. CORE-01
2. CORE-02
3. CORE-03
4. CORE-04
5. CORE-05
6. CORE-06
7. AUTO-01
8. AUTO-02

Do not start with a visual Pipeline builder.

## Work de-emphasised during early Core epics

Preserve but avoid broad feature expansion in Analysis Studio, Planner, Calendar, Instrument Monitor, Report Builder, Storage/freezer, Plate Designer and new dashboard surfaces until the early Core substrate is proven. Bug/security fixes and convergence changes remain appropriate.

Review the open immutable-analysis work against Dataset Versions, Pipeline Runs and Notebook frozen evidence before allowing it to establish a separate transformation architecture.

## Delivery rules

- Build narrow end-to-end slices through DB/RLS/API/UI/tests.
- Migrations are additive; never rewrite applied history.
- Stable semantic IDs back dependencies.
- Audit history is not a substitute for immutable scientific versions.
- Archive/retire rather than destructively deleting referenced scientific objects.
- Hard deletion is dependency-aware and blocked by immutable evidence.
- Shared Sheet Instances are explicit.
- Sheet duplication does not implicitly duplicate Datasets.
- Reuse uses composition, not Definition/Template inheritance.
- Sheet composition is virtual until explicitly materialised.
- Materialisation records provenance and aligns with future Pipeline semantics.
- AI never bypasses ordinary permissions/validation/provenance.
- Add implementation ADRs only when evidence exposes a real durable fork not already settled by ADRs 0020–0024.
