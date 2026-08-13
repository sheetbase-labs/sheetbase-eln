# Sheetbase Core Architecture

> **Status:** Target architecture for the Core Data Workspace programme.  
> **Product semantics:** `PRODUCT_CORE.md`.  
> **Accepted durable decisions:** ADRs 0020–0024.  
> **Migration:** `CORE_MIGRATION.md`.

## 1. Objective

Converge Sheetbase onto a small set of durable primitives so Notebooks, registries, Datasets, analysis, reporting, instruments and future automation share identities/contracts rather than creating parallel systems.

Preserve PostgreSQL authority, PostgREST, RLS, Handsontable, HyperFormula, stable calculation/provenance semantics and the dense UI system. This is convergence, not a rewrite.

## 2. Organisational boundary

Reusable definitions/configuration are organisation/tenant-scoped and permission-controlled:

```text
Organisation / tenant
|
+-- Models
+-- Dataset Schemas
+-- Sheet Definitions
+-- Notebook Templates
+-- Vocabularies
|
`-- Projects / working contexts
    +-- Records
    +-- Datasets
    +-- Notebooks
    `-- Sheet Instances
```

Do not implement a package/install system for normal intra-organisation reuse in the Core. Exact migration from today's workspace-scoped definitions to the organisational configuration layer must preserve current RLS and is an implementation decision requiring care.

## 3. Dependency direction

```text
Field semantics + capabilities
        |
        v
Models + Dataset Schemas
        |
        v
Records + Datasets (+ immutable Dataset Versions)
        |
        v
Sheet Definitions
        |
        v
Sheet Instances + calculations + presentation state
        |
        v
Notebook / Notebook Template composition
        |
        v
Pipeline Definitions + Runs
```

Higher-level objects compose lower-level objects; they do not create hidden copies or competing semantic systems.

## 4. Common field kernel

Models and Dataset Schemas consume the canonical semantic field contract in `src/lib/field-definition.ts`, grounded by `docs/core/audits/FIELD_SCHEMA_AUDIT.md`.

Semantic unification does not require identical physical storage.

Stable semantic field IDs underpin dependencies. Labels, visual positions and A1 coordinates do not.

## 5. Models and Records

A Model has stable identity while Field Definitions evolve through durable identities/lifecycle. Do not create a separate user-facing Model identity for each definition edit.

Records retain stable identity through Model evolution. Historical values remain interpretable after field retirement. At frozen evidence boundaries, record/reference a semantic manifest sufficient to reconstruct relevant Model/Field meaning.

The existing Model registry and revision-manifest direction are the foundation.

## 6. Dataset, Schema and Version

A Dataset is independently addressable rectangular data and is not owned by a Sheet/Template.

```text
Dataset
  id
  tenant/workspace context
  project_id?
  schema_id
  current_schema_version
  lifecycle_state
  provenance
```

Dataset Schemas have stable identity plus explicit immutable versions.

A Dataset normally has mutable live state. Individual changes are auditable but do not create a new Dataset Version automatically.

```text
Dataset
  +-- live mutable state
  +-- Dataset Version 1 [immutable]
  `-- Dataset Version 2 [immutable]
```

Meaningful immutable boundaries include explicit snapshot, Notebook submission evidence, Pipeline input/output, publication/release and migrations requiring a before/after boundary.

Pipeline inputs and submitted evidence resolve to immutable state.

Breaking schema changes create new schema versions and explicit migration/transformation; stored values are never silently reinterpreted.

## 7. Typed parameters and compatibility

Sheet Definitions, Notebook Templates and future Pipelines share one typed Parameter contract.

Conceptually:

```text
Parameter
  id
  key
  type
  required
  default?
  constraints?
```

Expected kinds include scalars and typed object references such as `Record<Model>`, `Dataset<contract>` and `DatasetVersion<contract>`.

Parameters can flow through composition (for example Notebook Template `study` satisfying a nested Sheet Definition `study`).

Dataset binding compatibility supports:

1. exact schema/version;
2. compatible schema lineage;
3. semantic/structural contract.

Compatibility uses stable semantic contracts, never labels alone.

## 8. Sheet Definition

A Sheet Definition is reusable, versioned composition/configuration.

```text
SheetDefinition
  id
  organisation_id
  version
  lifecycle_state
  parameters[]
  binding_specs[]
  row_identity_spec
  joins[]
  columns[]
  calculations[]
  writeback_rules[]
  record_actions[]
  presentation_defaults?
```

Definitions are immutable-by-version for dependency purposes. Publishing creates a new version. Existing Templates and Instances remain pinned until explicitly updated/upgraded.

Definitions do not inherit from other Definitions. If reusable substructures are later required, use explicit versioned composition fragments.

Definitions never own experiment-specific local values.

## 9. Sheet Instance

A Sheet Instance is the actual working spreadsheet object.

```text
SheetInstance
  id
  project/workspace context
  notebook_id?
  definition_id?
  definition_version?
  resolved_bindings[]
  local_field_definitions[]
  local_values[]
  calculations/overrides[]
  presentation_state
  lifecycle_state
  provenance
```

Instances may be created from a Definition, ad hoc, or by Template instantiation.

Local/ad hoc fields are durable typed Instance-owned data. `ad hoc` means locally governed, not ephemeral.

## 10. Save Instance as Definition

A useful ad hoc Instance can be converted into reusable configuration by extracting structure rather than copying working values.

Concrete source bindings can become typed parameters; local field definitions may become empty predefined local columns; reusable calculations may be retained; presentation state may become defaults.

Working/local values are excluded.

## 11. Definition upgrades

Instances never silently follow Definition changes.

Explicit upgrade is conceptually a three-way migration:

```text
        source Definition version
          /                 \
Instance-specific state   target Definition version
          \                 /
           explicit upgrade
```

Upgrades cannot silently destroy Instance-owned data. Conflicts require explicit resolution.

## 12. Row identity and joins

Row identity is source, composite or local and never visual row position.

Joins begin constrained: explicit equality joins plus cardinality expectations. Unexpected many-to-many expansion is surfaced rather than silently multiplying rows.

## 13. Columns and write-back

Column kinds:

- Dataset field;
- Model field;
- relationship;
- local;
- calculated.

Every writable displayed value resolves to exactly one authoritative target: Dataset field, Model field or Sheet-Instance-local field.

Calculated values are not directly writable.

## 14. Calculations

Preserve existing durable formula definitions, deterministic function profile, stable dependency IDs beneath A1 presentation and non-authoritative result-cache semantics.

Calculations have explicit scope:

```text
Instance calculation
      |
      | explicit promotion
      v
Definition calculation
      |
      | explicit promotion when it is truly Dataset semantics
      v
Dataset Schema derived field
```

A Dataset-derived field must remain meaningful/API-addressable independently of Handsontable.

Pipelines are broader transformations and are not simply another calculation scope.

## 15. Presentation state

For the Core, persist presentation/query state directly for the Sheet Instance as appropriate: filters, sorts, grouping, column order/visibility/width, freezing and density.

Do not require a first-class named View subsystem for Core implementation. Named personal/shared/default Views can be added later if demonstrated useful. Presentation state never alters data/schema semantics.

## 16. Notebook Templates

Notebook Templates are organisation-level reusable versioned compositions. They do not inherit from other Templates.

A Sheet block normally references a pinned Sheet Definition version and uses `create_instance`.

Explicit alternative behaviours:

- `reference_shared_instance` — intentionally reference an existing live Sheet Instance;
- `pinned_snapshot` — frozen/read-only state.

Publishing a new Definition version does not change existing Template versions. Updating a Template dependency is explicit.

Future repeated Template content should use explicit reusable versioned Template Sections rather than inheritance.

## 17. Shared Sheet Instances

Shared live Instances are explicit and visibly shared. Editing from any embedding changes the same Instance, including its local values.

Submitted/reviewed Notebooks snapshot/pin the relevant Sheet state so evidence does not remain live.

## 18. Lifecycle and deletion

Durable scientific objects have Workspace/tenant lifecycle ownership rather than individual-user ownership.

Lifecycle vocabulary:

- **archive:** remove from normal active use while preserving identity/references;
- **retire:** Definition/schema unavailable for new use while preserving existing dependants/history;
- **hard delete:** exceptional destructive removal, blocked by protected dependencies/evidence.

Existing permitted references to archived objects remain resolvable. New consumers are normally blocked.

## 19. Duplication

Duplicating a Sheet Instance creates an independent Instance and copies appropriate Instance-owned state. It does not duplicate bound Datasets/Records.

Dataset duplication is a separate explicit operation. Complex Notebook duplication should expose copy/reference policy rather than silently guessing.

## 20. Promotion

Local fields/calculations can be explicitly promoted subject to capability, compatibility, validation and impact review.

Promotion into a Dataset/Model schema follows schema versioning rules and may explicitly migrate/copy existing values. Historical Sheet snapshots retain their original local identity.

## 21. Materialisation

Sheet composition is virtual by default.

```text
Dataset A --+
Dataset B --+--> Sheet Instance --> composed result
Model ------+
Local ------+
Formula ----+
```

Materialisation explicitly creates a new Dataset and records source-version, calculation, Sheet context, actor/time and other required provenance.

This mechanism must be designed to align with future Pipeline input/output/run provenance rather than becoming a parallel transformation system.

## 22. Frozen Notebook evidence

A submitted Notebook must be able to reconstruct relevant state:

```text
Notebook submission [immutable]
  +-- Dataset Version(s)
  +-- Model/Field semantic manifest(s)
  +-- Sheet Definition version(s)
  +-- Sheet Instance snapshot(s)
  |     +-- local field definitions
  |     `-- local values
  `-- Calculation evidence
```

Exact physical snapshot storage is deferred.

## 23. Capabilities

RLS remains the security boundary. Evolve from coarse workspace roles toward distinct capabilities for data mutation, schema configuration, Definition/Template publication, Instance sharing/upgrading, Pipeline authoring/running, review/signing and administration.

Do not implement the complete future matrix in one migration.

## 24. Record creation

Sheet Instances support Record search/link, inline creation and validated bulk creation from rows. Definitions may configure allowed/default actions. Execution uses normal server-side validation/capabilities.

## 25. API and bulk operations

Important primitives have stable API identity. Purpose-built controlled RPCs are appropriate for operations such as bulk Dataset writes, bulk Record creation, schema publication, local-field promotion, Definition upgrade and materialisation.

Do not expose privileged generic SQL execution.

## 26. Performance

Spreadsheet interaction must not imply complete browser materialisation. Use virtualisation/windowed access, server filtering/sorting/grouping and bulk mutation. Explicitly distinguish loaded-window from whole-Dataset operations.

## 27. Agent boundary

Agents use ordinary contracts. Agent-generated schema/Definition/Pipeline changes begin as drafts and pass normal validation, capability, impact and approval flows.

## 28. Deferred implementation ADRs

ADRs 0020–0024 settle product semantics. Further implementation ADRs are required only where actual implementation evidence presents meaningful alternatives, including:

- Dataset physical storage/snapshot implementation;
- organisation-level definition storage/RLS migration from current workspace model;
- Dataset schema compatibility algorithm;
- Sheet Definition/Instance physical persistence;
- row identity/join implementation;
- bulk validation/commit semantics;
- multi-source formula resolution;
- capability/policy storage;
- Pipeline execution isolation/provenance.
