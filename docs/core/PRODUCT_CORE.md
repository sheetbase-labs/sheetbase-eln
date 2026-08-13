# Sheetbase Core Product Model

> **Status:** Canonical product direction for the Sheetbase core.  
> **Audience:** Product contributors, engineers, design agents and implementation agents.  
> **Read with:** `CORE_ARCHITECTURE.md`, `CORE_MIGRATION.md`, and the repository `ROADMAP.md`.

## 1. Product thesis

Sheetbase is a scientific data workspace with an ELN as its contextual record and an Excel-like sheet as its primary structured-data interaction surface.

Scientists should be able to work naturally in sheets without giving up typed data, durable identities, provenance, APIs, permissions, model governance or future automation.

The product combines four ideas:

1. **Notebook context** — narrative scientific work remains coherent and reconstructable.
2. **Spreadsheet fluency** — repeated scientific data entry and calculation should feel familiar to Excel users.
3. **Database integrity** — durable structured data is PostgreSQL-authoritative, typed and API-addressable.
4. **Composable automation** — calculations and future pipelines operate on the same models and datasets rather than creating a parallel data system.

## 2. Principles that are now locked

### 2.1 The notebook remains the centre of scientific context

A notebook contains the narrative, methods, reasoning, embedded working surfaces and evidence that explain an experiment or body of work.

The notebook is not the sole owner of all data displayed inside it. It can embed live or frozen views of records, datasets, sheets, calculations, charts and later pipeline results.

### 2.2 Sheets are the primary structured-data workspace

A Sheet is **not** synonymous with a database table and is **not** limited to one Dataset.

A Sheet is an Excel-like compositional data workspace that can:

- project one Dataset;
- combine multiple Datasets;
- include Model/Record fields;
- join sources using explicit semantic keys;
- contain sheet-local/ad hoc columns;
- contain calculated columns;
- link existing Records;
- create Records inline or in bulk;
- write edits back to explicit authoritative targets.

Every displayed value should have inspectable provenance. Every writable value must have exactly one authoritative write target.

### 2.3 Excel familiarity is an interaction goal, not a data model

Sheetbase should support familiar spreadsheet behaviours such as keyboard navigation, copy/paste, fill, formulas, A1 display, range selection, undo/redo, resizing and filtering.

It must not inherit spreadsheet ambiguity where that would undermine scientific data integrity.

Examples:

- column labels are not durable identities;
- A1 coordinates are not semantic identities;
- inserting a governed column is a schema/configuration operation;
- deleting a governed field must respect dependencies and lifecycle;
- bulk paste must be validated at the server boundary;
- calculations must remain reconstructable.

### 2.4 Models are explicit and user-extensible

A Model defines an addressable scientific or business object such as Sample, Reagent, Lentivector, Study, Instrument or Batch.

Models combine protected platform fields with workspace-configured fields. Authorised users can evolve workspace definitions without application developers adding every scientific property.

Schema authority is distinct from record-edit authority.

### 2.5 Models and Datasets share a schema language

Model fields and Dataset columns do not have to use identical physical PostgreSQL storage, but they should share a common semantic field kernel: stable IDs, types, units, constraints, controlled vocabularies, relationships, cardinality and lifecycle.

This allows Sheets, APIs, calculations, filters, pipelines and future agents to reason about fields consistently.

### 2.6 Configuration is capability-based

Different users require different configuration authority.

A scientist may be allowed to create data and add local Sheet columns while being unable to publish a Model schema. A data steward may manage Model and Dataset schemas without being a security administrator. A workflow builder may author Pipelines without managing users.

Do not collapse all configuration into `member` versus `admin`.

### 2.7 PostgreSQL remains authoritative

Client state, Handsontable state, calculated caches and optimistic updates are projections.

Durable writes must pass the PostgreSQL/API boundary for authentication, authorisation, validation, constraints and audit/event behaviour.

### 2.8 Information density is a product requirement

Sheetbase is for sustained scientific work on information-rich screens.

Default product behaviour should be compact, legible and keyboard-efficient. The main work plane should dominate. Inspectors should reveal contextual detail rather than duplicate the work plane in cards.

Large data must remain performant through virtualisation, incremental loading and server-side operations where appropriate.

### 2.9 AI is assistive and uses normal platform contracts

Future agents do not receive a privileged data path.

Agent-authored changes should resolve to the same typed schema, record, dataset and pipeline operations available to humans and code, with normal permissions, validation, provenance and approval policy.

## 3. Core product primitives

### 3.1 Model

Defines a durable type of addressable object.

Examples: Sample, Reagent, Lentivector, Study, Instrument, Batch.

A Model owns or references:

- immutable identity;
- protected base fields;
- workspace fields;
- relationships;
- validation;
- lifecycle/version information;
- configuration permissions.

A Model is not a form. Forms, registries, inspectors and Sheets are interaction surfaces over Models and Records.

### 3.2 Record

One instance of a Model.

Records have stable identities and can appear in registries, Sheet cells, notebook links, relationships, datasets, storage views, reports and pipeline inputs/outputs.

### 3.3 Field Definition

A stable semantic definition consumed by Models and Dataset Schemas.

Typical semantics include:

- stable `field_id`;
- key and label;
- description;
- value type;
- nullability/requiredness;
- cardinality;
- unit dimension and allowed units;
- default;
- validation constraints;
- controlled vocabulary;
- relationship target;
- computed/derived status;
- lifecycle state.

### 3.4 Dataset

A durable, addressable rectangular data object with an explicit Dataset Schema.

A Dataset owns:

- stable dataset identity;
- stable row identities;
- stable field/column identities;
- schema/version binding;
- provenance;
- project/workspace context;
- lifecycle/status;
- permissions.

A Dataset is independent of how it is displayed.

### 3.5 Dataset Schema

Defines the durable columns, types, constraints and relationships for a Dataset.

Dataset Schemas consume the common Field Definition language while retaining dataset-specific semantics such as row identity and data-shape constraints.

### 3.6 Sheet

A compositional Excel-like workspace.

A Sheet owns the composition between sources and presentation, including:

- source bindings;
- row identity strategy;
- join rules;
- Sheet columns;
- write-back rules;
- record actions;
- calculations;
- saved view/presentation state.

A Sheet may combine multiple Datasets and Models while also owning local columns.

### 3.7 Sheet Binding

Connects a Sheet to a source.

Initial binding kinds should include:

- Dataset;
- Model/Record collection;
- later: Pipeline output or external read-only source where justified.

Bindings define source identity, alias, version/live policy and permissions.

### 3.8 Sheet Column

A column visible in a Sheet.

Initial source kinds:

1. `dataset_field` — projects a field from a bound Dataset;
2. `model_field` — projects a field from a bound Model/Record source;
3. `relationship` — references another Record/Model;
4. `local` — data owned by the Sheet composition;
5. `calculated` — deterministic derived values.

A column has a stable Sheet-column identity independent of its display label and visual position.

### 3.9 Row Identity

Defines what one composed Sheet row represents.

Examples:

- `Sample.id`;
- `Batch.id`;
- `[Sample.id, Timepoint]`;
- `[Plate.id, Well]`;
- a Sheet-local row ID.

Row identity is fundamental to joins, write-back, formulas, record creation and deduplication.

### 3.10 View

Saved presentation/query state over a Sheet or Dataset.

Examples include filters, sorting, grouping, hidden columns, widths, frozen columns and task-specific layouts.

Views do not change data semantics.

### 3.11 Calculation

A deterministic derived value or transformation with durable definition and provenance.

Spreadsheet formulas are the smallest transformation primitive in Sheetbase and should remain compatible with future Pipeline concepts without being forced into a full Pipeline abstraction.

### 3.12 Pipeline

A versioned transformation from declared inputs to declared outputs.

Future implementation types may include:

- configured transforms;
- SQL;
- Python/code;
- ingestion/connectors;
- composite pipelines;
- agent-authored definitions.

A Pipeline definition and a Pipeline run are separate objects.

### 3.13 Pipeline Run

Immutable evidence of one execution, including definition version, input versions, parameters, actor, outputs, status, logs and evidence/provenance information.

### 3.14 Notebook

The narrative scientific record and context surface.

A Notebook can contain prose, protocols, Sheets, Dataset views, Model/Record links, files, charts, calculations, comments, review state and later Pipeline results.

### 3.15 Template

A reusable composition of Notebook blocks, Sheet definitions, views, protocols or other configured structures.

Templates should reference governed definitions rather than duplicating semantic schemas invisibly.

### 3.16 Policy / Capability

Defines who may read, mutate, configure, publish, run, approve or administer each class of object/action.

## 4. The compositional Sheet contract

A Sheet should support a workflow such as:

```text
Sheet: Transduction summary

Bindings
  samples      -> Model(Sample)
  qPCR         -> Dataset(qPCR Results)
  cell_counts  -> Dataset(Cell Counts)

Row identity
  Sample.id

Joins
  samples.id = qPCR.sample_id
  samples.id = cell_counts.sample_id

Columns
  Sample               -> samples.name
  Vector               -> samples.vector
  Copies / cell        -> qPCR.copies_per_cell
  Viable cells         -> cell_counts.viable_cells
  Normalised copies    -> calculated
  Scientist comment    -> local
```

The scientist sees one coherent spreadsheet. Sheetbase retains the source and write target of each value.

## 5. Ad hoc columns and promotion

Scientific work is exploratory. Users must not have to design the final schema before entering useful data.

Sheet-local columns therefore remain a first-class concept.

A local column may later be promoted, subject to permission and validation, into:

- a Dataset Schema field;
- a Model field;
- a reusable calculated field;
- a Pipeline output.

This supports the progression:

**ad hoc → useful → governed**.

Promotion must be explicit and show data/dependency impact.

## 6. Record creation from Sheets

Record creation is a core Sheet capability, not an import workaround.

### 6.1 Link an existing Record

A Record-reference cell searches permitted Records and stores a stable Record identity.

### 6.2 Create a Record inline

When policy permits, a user can create a missing Record from a Sheet cell/row. Required missing properties can be completed inline or in a compact inspector/popover.

### 6.3 Bulk-create Records

Users can paste or select many rows and request record creation.

Before commit, Sheetbase should validate the complete operation and present actionable row-level issues, for example:

```text
197 records ready to create
3 rows need attention
- row 18: Generation is required
- row 71: Sample ID already exists
- row 164: Vector VEC-992 cannot be resolved
```

The user fixes errors in the Sheet and commits the valid operation.

### 6.4 Record actions

A Sheet may expose configured actions such as:

- link Record;
- create Record;
- update Record;
- append Dataset row;
- later: run Pipeline.

Actions must use normal permission and validation contracts.

## 7. Write-back rule

A Sheet may display values from many sources, but **every writable cell has exactly one authoritative write target**.

Examples:

- `Sample.description` writes to a Sample Record;
- `qPCR.ct` writes to the qPCR Dataset;
- `Scientist comment` writes to Sheet-local storage;
- `Recovery` is calculated and is not directly writable.

Ambiguous write-back is invalid configuration.

## 8. Live and snapshot semantics

Every embedded structured object must explicitly identify whether it is:

- live data;
- a live saved View;
- a pinned/frozen Dataset version;
- a recorded Calculation/Pipeline result;
- part of a submitted immutable Notebook version.

This distinction must be inspectable and preserved in review/evidence workflows.

## 9. Role and capability direction

Default personas are convenience bundles, not hard-coded security roles.

Suggested bundles:

- Viewer;
- Scientist;
- Project Lead;
- Data Steward / Model Designer;
- Workflow Builder;
- Reviewer / Quality;
- Workspace Admin.

Capability families should eventually cover:

- data read/create/update/archive/export;
- schema read/create/edit/publish/retire;
- dataset create/bulk-edit/schema-edit;
- calculation author/use;
- pipeline run/author/publish/schedule/approve;
- AI use/propose-write/execute-write/configure;
- review comment/submit/approve/sign;
- workspace user/role/integration administration.

## 10. Product hierarchy

A useful mental model is:

```text
Workspace
├── Models
│   ├── Model definitions
│   ├── Records
│   └── Relationships
├── Data
│   ├── Datasets
│   ├── Sheets / Views
│   └── Calculations
├── Work
│   ├── Projects
│   ├── Studies
│   ├── Experiments / Notebooks
│   └── Reviews
├── Automation
│   ├── Pipeline definitions
│   └── Pipeline runs
└── Configuration
    ├── Roles / policies
    ├── Vocabularies
    ├── Integrations
    └── Audit / administration
```

This is a conceptual hierarchy, not a requirement to expose these exact navigation groups.

## 11. What not to do

Do not:

- make each specialist workspace a separate data architecture;
- make a Sheet equal one physical database table;
- make a Dataset equal one visual grid;
- use labels, row positions or A1 coordinates as durable semantic identities;
- let schema changes silently break historical data or calculations;
- create an agent-only mutation path;
- build a visual Pipeline DAG editor before Pipeline definition/run semantics exist;
- require administrators to pre-model every exploratory scientific column;
- expose all configuration to all users merely because it is technically possible.

## 12. Definition of the next successful product slice

The next core slice is successful when an authorised scientist can:

1. create or select a Notebook;
2. insert a Sheet;
3. start blank, from a Dataset, or combine data sources;
4. bind multiple Datasets and a Model;
5. choose/define row identity and joins;
6. add local and calculated columns;
7. paste substantial data efficiently;
8. link existing Records;
9. create missing Records inline and in bulk;
10. edit writable values back to their authoritative sources;
11. filter/sort and save a View;
12. inspect provenance and API identities;
13. reload and reconstruct the same state without hidden client-only truth.

This workflow is the product centre for the next engineering cycle.