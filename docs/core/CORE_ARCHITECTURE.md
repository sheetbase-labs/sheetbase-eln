# Sheetbase Core Architecture

> **Status:** Target architecture and implementation constraints for the Core Data Workspace programme.  
> **Product semantics:** `PRODUCT_CORE.md` is authoritative for product meaning.  
> **Migration:** see `CORE_MIGRATION.md` for how current code maps to this target.

## 1. Architectural objective

Converge Sheetbase onto a small set of durable primitives so notebooks, registries, datasets, analysis, reporting, instruments and future automation operate on the same identities and contracts.

The architecture must preserve the existing strengths:

- PostgreSQL authority;
- PostgREST as the primary data API;
- row-level security as the access boundary;
- Handsontable for spreadsheet interaction;
- HyperFormula for deterministic spreadsheet calculation;
- stable formula/provenance semantics;
- dense shared UI primitives and inspectors.

The work is convergence, not a rewrite.

## 2. Dependency direction

The intended dependency direction is:

```text
Field semantics / policy
        ↓
Models + Dataset Schemas
        ↓
Records + Datasets
        ↓
Sheet bindings / composition
        ↓
Calculations
        ↓
Notebook embedding / Views
        ↓
Pipeline definitions + runs
        ↓
Analysis / reporting / agents / specialist workspaces
```

Higher-level surfaces may compose lower-level primitives. They should not create competing definitions of them.

## 3. Common field kernel

Introduce or evolve toward one semantic field contract used by Model fields and Dataset Schema fields.

Conceptual shape:

```text
FieldDefinition
  id                  immutable
  workspace_id
  key                 stable machine-facing key under controlled rename rules
  label               human-facing
  description
  value_type
  nullable
  cardinality
  unit_dimension?
  allowed_units?
  default_value?
  validation?
  vocabulary_id?
  relationship_target_model_id?
  computed             boolean
  sensitivity_class?
  lifecycle_state
  created_at/by
  updated_at/by
```

Initial value types should remain deliberately small:

- text;
- integer;
- decimal;
- boolean;
- date;
- datetime;
- duration;
- categorical;
- record reference;
- file reference;
- structured/JSON only where a richer first-class type is not justified.

Scientific specialisation should normally be metadata over these primitives: unit dimensions, concentration, sequence metadata, ontology references, plate/well semantics, etc.

### Constraint

Semantic unification does **not** require one physical EAV table. System models, extension properties and large scientific datasets may use different physical PostgreSQL strategies.

## 4. Model contracts

The existing model registry is the starting point.

A Model Definition requires:

- immutable model identity;
- protected/base field registry;
- workspace extension fields;
- field lifecycle;
- relationship definitions;
- validation at the PostgreSQL boundary;
- explicit schema/configuration capabilities;
- dependency discovery before breaking change;
- auditable configuration changes.

### Schema lifecycle

Use explicit lifecycle semantics. A useful initial vocabulary is:

- `draft`;
- `published` / `active`;
- `deprecated`;
- `retired`.

Classify changes as:

- presentation-only;
- backward-compatible;
- validation-affecting;
- migration-required;
- breaking.

Historical values must remain interpretable after field retirement.

## 5. Dataset contracts

A Dataset is an addressable data object, not a Sheet.

Conceptual shape:

```text
Dataset
  id
  workspace_id
  project_id?
  name
  schema_id
  schema_version
  status
  provenance
  created_at/by
  updated_at/by
```

A Dataset requires stable row identity. Do not use visual row number as identity.

Dataset fields require stable IDs independent of display order and label.

### Dataset storage

Do not prematurely mandate one physical strategy for all datasets. Evaluate relational tables, controlled generated relations/partitions and metadata-driven storage against:

- PostgREST discoverability;
- RLS;
- bulk writes;
- schema evolution;
- query performance;
- large datasets;
- formula and pipeline references.

Whichever strategy is selected, external contracts bind to stable semantic IDs.

## 6. Sheet contracts

A Sheet is a composition over sources.

Conceptual shape:

```text
Sheet
  id
  workspace_id
  notebook_id?
  name
  row_identity_spec
  bindings[]
  joins[]
  columns[]
  writeback_rules[]
  record_actions[]
  default_view_id?
  lifecycle/status
```

### 6.1 Binding

```text
SheetBinding
  id
  sheet_id
  alias
  source_kind          dataset | model
  source_id
  source_version_policy live | pinned
  pinned_version?
```

Bindings are explicit and addressable. A Sheet may contain multiple bindings.

### 6.2 Row identity

```text
RowIdentitySpec
  kind                 source | composite | local
  source_fields[]
```

Examples:

- Sample record ID;
- `[sample_id, timepoint]`;
- `[plate_id, well]`;
- Sheet-local UUID.

A Sheet configuration is invalid if its joins cannot produce deterministic row identity under the selected semantics.

### 6.3 Joins

Initial joins should remain intentionally constrained and explainable.

```text
SheetJoin
  left_binding
  left_field
  right_binding
  right_field
  join_type
  cardinality_expectation
```

Start with equality joins and explicit cardinality expectations. Do not attempt to recreate arbitrary SQL in the Sheet configuration UI.

Ambiguous many-to-many expansion should require explicit handling rather than silently multiplying rows.

### 6.4 Columns

```text
SheetColumn
  id
  sheet_id
  label
  source_kind          dataset_field | model_field | relationship | local | calculated
  binding_id?
  source_field_id?
  local_field_definition?
  calculation_id?
  writable
  writeback_target?
  display_config
  position
```

### 6.5 Local columns

Local column values are durable Sheet-owned data, not browser-only state.

They need:

- stable row association;
- typed values;
- validation;
- API access where appropriate;
- audit/change behaviour;
- promotion path into governed schemas.

### 6.6 Write-back

Every writable column/cell resolves to exactly one target:

```text
WritebackTarget
  target_kind          dataset_field | model_field | sheet_local
  binding_id?
  field_id
```

Calculated values are read-only unless an explicit materialisation operation creates a new governed output.

### 6.7 Record actions

Initial record operations:

```text
RecordAction
  link_existing
  create_inline
  create_bulk
  update_bound_record
```

Bulk creation should be implemented as validate/preview/commit rather than row-at-a-time network calls.

The server must return structured row/field errors suitable for rendering directly in the grid.

## 7. Calculation contracts

Preserve the existing direction:

- formula definitions are durable;
- evaluated values may be cached;
- formula references resolve to stable semantic identities underneath the Excel-like A1 representation;
- volatile/non-reproducible behaviour remains deliberately constrained;
- dependency graphs are explicit;
- errors are stored/represented without destroying definitions.

Multi-source Sheets mean formula resolution must operate against the composed Sheet row/column model while retaining source provenance.

Do not make display coordinates the persistent dependency key.

## 8. View contracts

Separate presentation from Sheet composition and data.

```text
View
  id
  owner_scope          user | team/workspace | template
  target_kind          sheet | dataset
  target_id
  filters
  sorts
  grouping
  column_order
  hidden_columns
  widths
  frozen_columns
  density
  display_options
```

A View must not mutate field semantics or write-back rules.

Role-specific default views can later be assigned through configuration/policy.

## 9. Notebook embedding

Notebook blocks should reference durable objects rather than duplicate them.

For a Sheet block, persist at minimum:

- Sheet identity;
- live versus pinned policy;
- optional View identity;
- block-specific display options.

A submitted Notebook version must be able to reconstruct the exact data/calculation state it claims to contain. This may require pinning Dataset/Sheet/Pipeline versions at submission rather than relying on live references.

## 10. Permissions and capability architecture

RLS remains the data boundary. Expand the product permission vocabulary beyond the current coarse membership roles.

Target capability families:

```text
data.read
 data.create
 data.update
 data.archive
 data.export

schema.read
 schema.create
 schema.edit
 schema.publish
 schema.retire

dataset.create
 dataset.bulk_edit
 dataset.schema_edit

calculation.author
 calculation.use

pipeline.run
 pipeline.author
 pipeline.publish
 pipeline.schedule
 pipeline.approve

agent.use
 agent.propose_write
 agent.execute_write
 agent.configure

review.comment
 review.submit
 review.approve
 review.sign

workspace.manage_users
 workspace.manage_roles
 workspace.manage_integrations
 workspace.manage_credentials
```

Do not implement the entire vocabulary in one migration. Introduce capability primitives with the first Core Data Workspace needs and keep the namespace extensible.

## 11. Pipeline boundary

Pipeline semantics should be specified before a workflow-builder UI.

```text
PipelineDefinition
  id
  name
  version
  implementation_type
  input_ports[]
  output_ports[]
  parameter_schema
  implementation_reference
  execution_policy
  permissions
  lifecycle_state
```

```text
PipelineRun
  id
  definition_id
  definition_version
  input_versions[]
  parameters
  initiated_by
  execution_identity
  started_at
  completed_at
  status
  output_versions[]
  logs_reference
  evidence_digest
```

Initial implementation types should probably be configured transform, SQL and Python. This is a later epic, not a prerequisite for compositional Sheets.

## 12. Agent boundary

Agent operations use ordinary platform contracts.

Target consequential-write lifecycle:

```text
intent
  ↓
structured proposed plan
  ↓
permission + schema validation
  ↓
human-visible diff/impact
  ↓
approval if policy requires
  ↓
normal mutation or Pipeline execution
  ↓
recorded provenance
```

Agent-generated schema or Pipeline definitions begin as drafts.

## 13. API requirements

Every important primitive should have a stable API identity.

The UI and external clients should operate on the same authoritative resources wherever practical.

Bulk Sheet operations need purpose-built controlled RPCs where direct CRUD would be inefficient or unable to express atomic validation/commit semantics.

Candidate operations include:

- validate bulk Dataset writes;
- commit bulk Dataset writes;
- validate bulk Record creation;
- commit bulk Record creation;
- apply schema change;
- promote local field;
- publish schema version.

Do not expose privileged generic SQL execution.

## 14. Performance requirements

The Sheet UX must not imply that all data is resident in browser memory.

Use:

- Handsontable rendering virtualisation;
- incremental/windowed data access where feasible;
- server-side filter/sort/group operations for large sources;
- bulk mutation endpoints;
- bounded formula/materialisation policies;
- explicit operation limits where full-dataset semantics are required;
- performance tests using representative scientific datasets.

The user must be told when an operation applies to a loaded window versus the complete Dataset; silent partial semantics are unacceptable.

## 15. Provenance requirements

At minimum, Sheetbase should be able to answer for a displayed value:

- what object/field produced it;
- whether it is live, local or calculated;
- what Record/Dataset row it belongs to;
- what calculation definition produced it, if derived;
- who/what last changed the authoritative value;
- whether the Notebook is showing live or pinned state.

Pipeline outputs later extend this chain with definition/run/input versions.

## 16. Configuration UI architecture

The Model/Dataset configuration experience should use a shared pattern:

- catalogue/navigation on the left;
- dense field/schema work plane in the centre;
- semantic/dependency inspector on the right;
- draft/published state and impact summary in the header.

The inspector should expose type, units, validation, relationships, permissions, dependencies and history.

Before a breaking change, show usage such as:

```text
Used by
  4 datasets
  2 sheets
  1 calculation
  1 pipeline
```

## 17. Engineering constraints

1. Prefer migrations that converge existing structures rather than replacing working systems.
2. Preserve current API/RLS guarantees.
3. Preserve stable formula IDs and calculation evidence.
4. Do not merge semantic schema and UI display metadata merely for convenience.
5. Add ADRs for durable decisions about Dataset physical storage, row identity, Sheet joins/write-back and schema versioning.
6. Each epic should deliver a narrow end-to-end demonstrable workflow.
7. No new specialist workspace should introduce a parallel source of truth.

## 18. Required ADRs during implementation

Create ADRs as these decisions are settled by implementation evidence:

- common field kernel and compatibility with current `model_fields`;
- Dataset physical storage strategy;
- Dataset schema versioning/migration;
- Sheet binding and row-identity semantics;
- Sheet local-column storage;
- Sheet join/cardinality policy;
- bulk validation/commit RPC contract;
- multi-source formula reference semantics;
- capability/policy storage and RLS mapping;
- Pipeline execution isolation and artifact/provenance model.
