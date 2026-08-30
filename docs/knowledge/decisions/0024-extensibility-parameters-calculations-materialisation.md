# ADR 0024 — Organisational Definitions, Parameters, Calculations and Materialisation

- Status: Accepted
- Date: 2026-08-13
- Related: ADR 0020–0023

## Context

Sheetbase needs reusable scientific configuration without an unnecessary package/install system, a consistent way to parameterise reusable objects, clear ownership of calculations, and an explicit boundary between virtual Sheet composition and durable output data.

## Decisions

### Reusable definitions live at the organisational configuration layer

Do not introduce live cross-workspace package/install semantics for normal reusable definitions.

The conceptual hierarchy is:

```text
Organisation / tenant
|
+-- reusable definitions/configuration
|   +-- Models
|   +-- Dataset Schemas
|   +-- Sheet Definitions
|   +-- Notebook Templates
|   `-- Vocabularies
|
`-- Projects / working contexts
    +-- Notebooks
    +-- Datasets
    +-- Records
    `-- Sheet Instances
```

Permissions determine who may use and configure shared definitions. Projects/workspaces organise scientific working data and instances.

Export/import between separate Sheetbase tenants may be designed later; it is not part of the Core model now.

### One typed Parameter system

Sheet Definitions, Notebook Templates and future Pipelines share one typed parameter concept rather than inventing separate parameter systems.

Parameters have stable identity, name, type, required/default semantics and constraints.

Expected parameter kinds include scalar values and typed object references such as `Record<Model>` and `Dataset<contract>`. Pipeline inputs that require immutable state may use `DatasetVersion<contract>`.

Parameters may flow through compositions. For example, a Notebook Template `study` parameter can satisfy a nested Sheet Definition `study` parameter without prompting twice.

### Views are not a major Core primitive yet

For the initial Core, a Sheet Instance persists presentation state such as filtering, sorting, visible columns, order, widths and frozen columns.

Named saved Views may be introduced later when users need multiple reusable layouts such as `QC Review` or `Compact`. If introduced, Views remain presentation/query state and never change data or schema semantics.

Do not build a substantial View subsystem merely to complete the Core ontology.

### Calculations have explicit scope

A calculation can belong to one of three scopes:

1. **Sheet Instance calculation** — exploratory/local to one working Instance.
2. **Sheet Definition calculation** — reusable calculation included in future Instances created from that Definition.
3. **Dataset Schema derived field** — calculation is part of the governed semantics of that Dataset type and is available independently of a particular Sheet UI.

```text
Sheet Instance calculation
          |
          | explicit promotion
          v
Sheet Definition calculation
          |
          | explicit promotion where semantically appropriate
          v
Dataset Schema derived field
```

Promotion is always explicit. A Sheet Definition calculation does not silently become part of a Dataset, and a Dataset-derived field must not depend on Handsontable as its authoritative execution/definition environment.

Pipelines are not simply another calculation scope. Pipelines represent broader transformations between declared inputs and outputs and remain a separate primitive.

### Sheet composition is virtual by default

Combining Datasets, Models, local fields and calculations in a Sheet Instance does not automatically create or copy a new Dataset.

```text
Dataset A --+
Dataset B --+--> Sheet Instance --> virtual composed result
Model ------+
Local ------+
Formula ----+
```

### Materialisation is explicit

A user may explicitly create a durable Dataset from a composed Sheet result.

```text
Sheet composition
      |
      | materialise
      v
New Dataset
  +-- source version provenance
  +-- Sheet Definition/Instance context
  +-- calculation definitions
  `-- actor/time/evidence
```

Materialisation must record enough provenance to reconstruct how the output was produced. It should be designed so future Pipeline execution can generalise the same input/output/provenance concepts rather than creating a second transformation model.

Promoting one calculation into a Dataset-derived field and materialising an entire Sheet are distinct operations.

## Consequences

- Shared definitions are simple to understand and do not require a package manager.
- Scientific working data remains clearly separated from reusable configuration.
- Templates, Sheet Definitions and Pipelines can share parameter semantics.
- The initial Sheet implementation avoids an unnecessary View subsystem.
- Exploratory calculations have a clear path to reusable/governed semantics.
- Virtual composition avoids unnecessary data duplication.
- Durable derived outputs are explicit and traceable.

## Rejected alternatives

- Publish/install package system for normal intra-organisation reuse: unnecessary complexity for the Core.
- Live cross-workspace definition copies/references as the primary reuse model: complicates lifecycle and permissions.
- Separate parameter languages for Templates, Sheets and Pipelines: duplicates semantics and prevents clean composition.
- First-class named Views as a prerequisite for Core Sheets: premature; persisted presentation state is sufficient initially.
- Treat all Sheet formulas as Dataset fields: confuses exploratory presentation with governed data semantics.
- Automatically materialise Sheet compositions: creates unnecessary copies and unclear provenance.
- Treat calculation promotion as Pipeline promotion: field derivation and broader data transformations are different concerns.

## Constraints

1. Reusable definitions are organisation/tenant configuration objects with permission-controlled use.
2. Do not build a package/install system for normal Core reuse.
3. Use one typed Parameter contract across reusable composition systems.
4. Presentation state must not alter data/schema semantics.
5. Calculation scope and promotion are explicit.
6. Sheet composition remains virtual unless materialisation is requested.
7. Materialised Datasets record source/calculation provenance.
8. Materialisation should remain compatible with future Pipeline Definition/Run semantics.
