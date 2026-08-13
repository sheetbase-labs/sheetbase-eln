# Sheetbase Core Architecture

> **Status:** Target architecture and implementation constraints for the Core Data Workspace programme.  
> **Product semantics:** `PRODUCT_CORE.md` is authoritative for product meaning.  
> **Durable Sheet decision:** ADR 0020 is authoritative for Definition/Instance/Template reuse semantics.  
> **Migration:** see `CORE_MIGRATION.md` for how current code maps to this target.

## 1. Architectural objective

Converge Sheetbase onto a small set of durable primitives so Notebooks, Templates, registries, Datasets, analysis, reporting, instruments and future automation operate on the same identities and contracts.

Preserve PostgreSQL authority, PostgREST, RLS, Handsontable, HyperFormula, stable formula/provenance semantics and the shared dense UI system. This is convergence, not a rewrite.

## 2. Dependency direction

```text
Field semantics / policy
        ↓
Models + Dataset Schemas
        ↓
Records + Datasets
        ↓
Sheet Definitions
        ↓
Sheet Instances + Views + Calculations
        ↓
Notebook / Notebook Template composition
        ↓
Pipeline Definitions + Runs
        ↓
Analysis / reporting / agents / specialist workspaces
```

Higher-level surfaces compose lower-level primitives; they must not create competing definitions or hidden copies of them.

## 3. Common field kernel

Models and Dataset Schemas consume one canonical semantic field contract. The executable TypeScript contract lives in `src/lib/field-definition.ts` and is grounded by `docs/core/audits/FIELD_SCHEMA_AUDIT.md`.

Semantic unification does **not** require one physical EAV table. System Models, extension properties and large scientific Datasets may use different PostgreSQL strategies while sharing stable semantic IDs/types/constraints.

## 4. Model contracts

The existing Model registry remains the foundation.

A Model Definition requires immutable identity, protected/base fields, workspace extension fields, field lifecycle, relationship definitions, PostgreSQL-boundary validation, configuration capabilities, dependency discovery and auditable configuration changes.

Historical values remain interpretable after field retirement. Schema changes are explicit and classified by compatibility/impact.

## 5. Dataset contracts

A Dataset is an independently addressable rectangular data object, not a Sheet and not owned by a Template.

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

Datasets require stable row and field identities independent of visual position or label. Physical storage is selected by ADR based on RLS, API discoverability, bulk writes, schema evolution, query performance, large-data behaviour and future calculation/Pipeline references.

## 6. Sheet Definition contracts

A `SheetDefinition` is reusable, versioned composition/configuration.

```text
SheetDefinition
  id
  workspace_id
  name
  version
  lifecycle_state
  input_parameters[]
  bindings[]
  row_identity_spec
  joins[]
  columns[]
  calculations[]
  writeback_rules[]
  record_actions[]
  default_view_definition?
  created_at/by
```

A Definition may bind directly to stable global/configuration sources (for example `Model(Sample)`) or declare parameters that must be resolved at instantiation.

Example parameter:

```text
InputParameter
  key: results_dataset
  source_kind: dataset
  compatibility:
    dataset_schema_id: assay_results
    minimum_schema_version?: 2
```

A Sheet Definition does not store experiment-specific local values.

### 6.1 Definition versions

Definitions are immutable-by-version for dependency purposes. Publishing a change creates a new version. Existing Templates and Instances remain pinned to their prior version until explicitly updated/upgraded.

A future compatible-follow policy may exist, but it must be explicit; silent propagation is prohibited.

## 7. Sheet Instance contracts

A `SheetInstance` is the working spreadsheet object.

```text
SheetInstance
  id
  workspace_id
  notebook_id?
  project_id?
  definition_id?
  definition_version?
  resolved_bindings[]
  local_field_definitions[]
  lifecycle_state
  provenance
  created_at/by
```

An Instance can be created:

- from a versioned Sheet Definition;
- ad hoc, where product policy permits;
- by a Notebook Template instantiation;
- later, from a Pipeline/automation composition operation.

When created from a Definition it records the exact `definition_id` + version.

Instance-specific local data belongs to the Instance. Reusing the Definition never shares these values.

## 8. Binding contracts

Definitions contain binding specifications; Instances contain resolved bindings.

```text
SheetBindingSpec
  id
  alias
  source_kind          dataset | model
  source_id?           fixed source where appropriate
  parameter_key?       parameterised source
  source_version_policy live | pinned
  compatibility?
```

```text
ResolvedSheetBinding
  binding_spec_id
  source_kind
  source_id
  resolved_version?
  resolution_provenance
```

A Definition may therefore be reusable across many Datasets that satisfy the same expected Dataset Schema.

## 9. Row identity and joins

```text
RowIdentitySpec
  kind                 source | composite | local
  source_fields[]
```

Rows may represent Sample IDs, `[Sample, Timepoint]`, `[Plate, Well]`, or local UUIDs.

Joins begin constrained and explainable:

```text
SheetJoin
  left_binding
  left_field
  right_binding
  right_field
  join_type
  cardinality_expectation
```

Unexpected many-to-many expansion must be surfaced rather than silently multiplying rows.

## 10. Column contracts

Definition-level column configuration is distinct from Instance-local state.

```text
SheetColumnDefinition
  id
  label
  source_kind          dataset_field | model_field | relationship | local | calculated
  binding_spec_id?
  source_field_id?
  local_field_definition?
  calculation_definition?
  writable
  writeback_target?
  display_defaults?
  position
```

For `local` columns, the Definition defines the field semantics while the Instance owns the values.

An ad hoc Instance may add new local fields not present in the source Definition. Promotion into a reusable Definition is a separate controlled operation.

## 11. Write-back

Every writable displayed value resolves to exactly one target:

```text
WritebackTarget
  target_kind          dataset_field | model_field | sheet_instance_local
  binding_spec_id?
  field_id
```

A Definition specifies the rule; an Instance resolves it through its actual bindings.

Calculated values are read-only unless an explicit materialisation operation creates a governed output.

## 12. Record actions

A Definition may configure allowed/default actions such as:

- link existing Record;
- create Record inline;
- bulk-create Records;
- update bound Record;
- append Dataset row;
- later run Pipeline.

The Instance executes actions using resolved bindings and normal server-side capability/validation contracts.

## 13. Calculation contracts

Preserve existing formula guarantees:

- durable definitions;
- cached evaluated values are not sole authority;
- stable semantic dependency IDs beneath A1 presentation;
- deterministic function profile;
- explicit dependency graphs;
- stored errors without destroying formulas.

Formula configuration may originate in a Sheet Definition; Instance execution resolves it against bound sources and Instance row identities.

## 14. View contracts

Views are presentation/query state over a Dataset or Sheet Instance, not a Definition's semantic identity.

```text
View
  id
  owner_scope          user | team/workspace | template_default
  target_kind          sheet_instance | dataset
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

A Sheet Definition may nominate default View configuration, but Instance/user Views remain independently mutable.

## 15. Notebook Template contracts

A Notebook Template is a versioned composition of block instructions. A predefined Sheet block references either a versioned Sheet Definition or an explicit existing shared Sheet Instance.

```text
TemplateSheetBlock
  sheet_definition_id?
  sheet_definition_version?
  shared_sheet_instance_id?
  instantiation_policy
  parameter_bindings[]
  default_view_config?
```

Initial `instantiation_policy` values:

- `create_instance` — default; instantiate a new Sheet Instance from the pinned Definition version;
- `reference_shared_instance` — deliberately reference an existing live Sheet Instance;
- `pinned_snapshot` — reference a frozen state for evidence/read-only use.

### 15.1 Template dependency rules

- Templates pin Sheet Definition versions by default.
- Publishing a new Definition version does not change existing Template versions.
- Updating a Template dependency is explicit and impact-aware.
- Existing Notebooks/Sheet Instances are not altered when a Template is updated.
- A Template owns instructions/composition, not authoritative Dataset or Instance-local scientific values.

## 16. Notebook embedding and frozen evidence

A Notebook block referencing a normal working Sheet stores the Sheet Instance identity and View/display state required to render it.

Submitted Notebook evidence must reconstruct exact structured state. Submission may therefore pin Dataset versions, Sheet Instance state, Definition versions, Calculation definitions/results and later Pipeline Run evidence rather than relying on live references.

Shared live instances remain valid during working state but must become explicitly frozen/pinned where submission semantics require immutability.

## 17. Reuse matrix

| Reused object | What is shared | What is not implicitly shared |
|---|---|---|
| Dataset | authoritative rectangular data | Sheet composition/local values |
| Sheet Definition | composition/configuration | resolved bindings, local values, working lifecycle |
| Sheet Instance | all working state of that Instance | other independent Instances |
| Notebook Template | composition/instantiation instructions | Notebook content or newly created Instance-local data |
| View | presentation/query state according to sharing scope | underlying data semantics |

This matrix is an invariant, not merely UI guidance.

## 18. Permissions and capabilities

RLS remains the data boundary. Capability vocabulary must eventually distinguish:

- data read/create/update/archive/export;
- schema read/create/edit/publish/retire;
- Dataset create/bulk-edit/schema-edit;
- Sheet Definition read/create/edit/publish;
- Sheet Instance create/edit/share/upgrade;
- Template read/create/edit/publish;
- calculation author/use;
- Pipeline run/author/publish/schedule/approve;
- agent use/propose-write/execute-write/configure;
- review/comment/submit/approve/sign;
- workspace administration.

Introduce these incrementally rather than in one migration.

## 19. Pipeline boundary

Pipelines operate primarily on typed data inputs/outputs, not Notebook Template internals.

A future operation may:

```text
Pipeline Run → Output Dataset
             → instantiate SheetDefinition X with output_dataset = Output Dataset
```

This keeps computation, presentation and Notebook composition separately reusable.

## 20. Agent boundary

Agents use ordinary platform contracts. They may later propose Sheet Definitions, Template dependency changes or Pipeline Definitions, but such changes begin as drafts and pass normal permission, validation, impact and approval flows.

## 21. API requirements

Every important primitive requires stable API identity: Model, Record, Dataset, Dataset Schema, Sheet Definition/version, Sheet Instance, View, Notebook Template/version, Calculation, Pipeline Definition/Run.

Controlled RPCs are appropriate for atomic/bulk operations such as bulk Dataset writes, Record creation, schema publication, local-field promotion and Definition/Template upgrades.

Do not expose privileged generic SQL execution.

## 22. Performance requirements

The spreadsheet UX must not imply all source data is resident in browser memory. Use virtualisation, windowed access, server-side filtering/sorting/grouping, bulk mutations and explicit whole-Dataset versus loaded-window semantics.

Reusable Definitions must not require duplicating source data merely to instantiate another Sheet.

## 23. Provenance requirements

For a displayed value, Sheetbase should be able to answer:

- which Sheet Instance and column produced/displayed it;
- which Sheet Definition/version configured it, if applicable;
- which resolved Dataset/Record/local value is authoritative;
- what row identity it belongs to;
- what Calculation produced it, if derived;
- who/what changed the authoritative value;
- whether the current Notebook view is live, shared-live or pinned.

## 24. Required ADRs during implementation

ADR 0020 already locks Sheet Definition/Instance/Template reuse semantics.

Further ADRs are still required as implementation evidence settles:

- common field kernel compatibility;
- Dataset physical storage and versioning;
- Sheet Definition/version persistence;
- Sheet Instance/local-value persistence;
- binding parameter compatibility/resolution;
- row identity and join/cardinality semantics;
- Definition-to-Instance upgrade/migration behaviour;
- Template dependency/version updates;
- bulk validation/commit RPCs;
- multi-source formula resolution;
- capability/policy storage and RLS mapping;
- Pipeline execution/provenance.
