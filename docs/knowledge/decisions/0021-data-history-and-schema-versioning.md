# ADR 0021 — Data History and Schema Versioning

- Status: Accepted
- Date: 2026-08-13
- Related: ADR 0020; `docs/core/PRODUCT_CORE.md`; `docs/core/CORE_ARCHITECTURE.md`

## Context

Sheetbase needs fluid spreadsheet-style scientific work while preserving exact historical states for submitted evidence and future Pipeline runs. Models must retain stable identity as user-extensible definitions evolve. Sheet-local/ad hoc columns must remain lightweight without becoming ephemeral.

## Decision

### Datasets

Datasets have mutable live working state plus immutable Dataset Versions created at meaningful boundaries. Individual edits remain auditable but do not create a new Dataset Version automatically.

Typical version boundaries include explicit snapshots, Notebook submission/signing where the Dataset contributes evidence, Pipeline inputs and outputs, publication/release, and migrations where a before/after state is required.

```text
Dataset
  +-- live state -- edit -- edit
  +-- Version 1 [immutable]
  +-- Version 2 [immutable]
  `-- current live state
```

Audit history answers **what changed?** A Dataset Version answers **what exact data state was used?**

Anything used as submitted scientific evidence or as a Pipeline input must resolve to immutable state.

### Dataset Schemas

Dataset Schemas have stable identity plus explicit immutable schema versions.

Changes are classified as presentation/non-semantic, compatible, migration-requiring, or breaking. Breaking semantic changes never silently reinterpret existing values. They require a new schema version and an explicit migration/transformation where existing data moves forward.

Consumers such as Sheet Definitions and Pipelines must eventually be able to state which schema version or compatibility contract they accept.

### Models

A Model such as `Lentivector` retains one stable Model identity. Its Field Definitions evolve through durable identities and lifecycle/history rather than creating separate user-facing Model identities for every definition change.

At important evidence boundaries, Sheetbase records a Model/Field definition manifest sufficient to reconstruct the semantics in force.

### Records

Records retain stable identity as their Model evolves. Retiring a field does not erase historical values or make them uninterpretable. Durable Field Definition identities and historical manifests preserve meaning.

Records do not permanently bind to one Model version during ordinary live operation. Frozen evidence records/references the semantic manifest required for historical interpretation.

### Ad hoc Sheet columns

A local/ad hoc column belongs to a Sheet Instance and does not automatically alter a bound Dataset Schema.

It has stable local field identity, canonical field semantics, durable values associated with Sheet row identity, and audit/provenance behaviour.

**Ad hoc means locally governed, not ephemeral.**

During active work its definition may evolve more lightly than a published Dataset Schema field. Once a Sheet Instance is snapshotted/submitted, the local field definitions and values in that snapshot are immutable historical evidence.

### Promotion

Promotion from a Sheet-local field to a governed Dataset Schema or Model field is explicit.

```text
Sheet-local field
      |
      | promote
      v
Dataset Schema / Model field
      |
      `-- explicit value migration/copy if requested
```

Promotion requires appropriate schema authority, validates existing values, evolves the governed schema according to its versioning rules, shows impact, and explicitly migrates/copies values where requested. Prior snapshots retain their historical local-field identity.

A local field never silently becomes governed merely because it is widely used.

## Frozen evidence

A frozen/submitted Notebook must be able to reconstruct the relevant semantic and data state:

```text
Notebook submission [immutable]
  +-- Dataset Version(s)
  +-- Model/Field definition manifest(s)
  +-- Sheet Definition version(s)
  +-- Sheet Instance snapshot(s)
  |     +-- local field definitions
  |     `-- local values
  `-- Calculation evidence
```

The physical snapshot implementation is deferred; these semantics are mandatory.

## Consequences

- Normal scientific editing remains fluid.
- Audit history and scientific versions have distinct purposes.
- Pipeline/submission states can be reconstructed exactly.
- Records retain identity through Model evolution.
- Exploratory columns do not pollute governed schemas.
- Useful exploratory work has a controlled promotion path.

Costs include explicit Dataset-version persistence, real schema migration/compatibility semantics, semantic manifests for frozen evidence, and promotion/impact UX.

## Rejected alternatives

- Version every Dataset mutation: too noisy; audit history records individual changes.
- Audit log only: reconstructing exact scientific states from events alone is unnecessarily fragile.
- Create a new Model identity on every definition change: fragments long-lived scientific object types.
- Permanently bind every Record to a Model version: unnecessary for live operation; evidence manifests preserve historical interpretation.
- Keep ad hoc fields only in client state: loses meaningful scientific data on reload/share/submission.
- Automatically promote ad hoc fields: exploration and governance require different lifecycle and permissions.

## Constraints

1. Audit events are not a substitute for immutable Dataset Versions.
2. Do not create a Dataset Version for every cell edit.
3. Breaking schema changes must not silently reinterpret stored values.
4. Retiring Model fields must not erase historical values.
5. Local values must not exist only in Handsontable/React state.
6. Local fields never silently become governed fields.
7. Pipeline inputs and submitted Notebook evidence resolve to immutable state.
8. Stable semantic IDs, not labels or visual positions, underpin historical interpretation.
