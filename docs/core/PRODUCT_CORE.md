# Sheetbase Core Product Model

> **Status:** Canonical product direction for the Sheetbase core.  
> **Audience:** Product contributors, engineers, design agents and implementation agents.  
> **Read with:** `CORE_ARCHITECTURE.md`, `CORE_MIGRATION.md`, `ROADMAP.md`, and ADR 0020.

## 1. Product thesis

Sheetbase is a scientific data workspace with an ELN as its contextual record and an Excel-like Sheet as its primary structured-data interaction surface.

Scientists should be able to work naturally in Sheets without giving up typed data, durable identities, provenance, APIs, permissions, model governance, reusable configuration or future automation.

The product combines four ideas:

1. **Notebook context** — narrative scientific work remains coherent and reconstructable.
2. **Spreadsheet fluency** — repeated scientific data entry and calculation should feel familiar to Excel users.
3. **Database integrity** — durable structured data is PostgreSQL-authoritative, typed and API-addressable.
4. **Composable automation and reuse** — reusable Sheet Definitions, calculations and future Pipelines operate on the same Models and Datasets rather than creating parallel data systems.

## 2. Principles that are now locked

### 2.1 The notebook remains the centre of scientific context

A Notebook contains the narrative, methods, reasoning, embedded working surfaces and evidence that explain an experiment or body of work.

The Notebook is not the sole owner of all data displayed inside it. It can embed live or frozen views of Records, Datasets, Sheet Instances, calculations, charts and later Pipeline results.

### 2.2 Sheets are the primary structured-data workspace

A working Sheet is **not** synonymous with a database table and is **not** limited to one Dataset.

A Sheet Instance is an Excel-like compositional data workspace that can:

- project one Dataset;
- combine multiple Datasets;
- include Model/Record fields;
- join sources using explicit semantic keys;
- contain Sheet-local/ad hoc columns;
- contain calculated columns;
- link existing Records;
- create Records inline or in bulk;
- write edits back to explicit authoritative targets.

Every displayed value should have inspectable provenance. Every writable value must have exactly one authoritative write target.

### 2.3 Reusable Sheet structure is separate from working Sheet state

Sheetbase distinguishes:

- **Sheet Definition** — reusable, versioned configuration describing composition and expected inputs;
- **Sheet Instance** — an instantiated working Sheet with resolved bindings, local values, lifecycle and provenance.

A Sheet Definition can be reused by many Notebook Templates and many Sheet Instances. Reuse of a Definition does not imply sharing working data.

Existing Sheet Instances remain associated with the exact Definition version from which they were created unless an explicit upgrade/migration is performed.

### 2.4 Datasets are independently reusable

A Dataset belongs to neither a Sheet Definition, Sheet Instance nor Notebook Template merely because it is referenced there.

The same Dataset may be displayed or combined in multiple Sheet Definitions, Sheet Instances, Notebook Templates or future Pipeline/result surfaces, subject to permissions and live/pinned policy.

### 2.5 Templates describe composition and instantiation, not hidden ownership

A Notebook Template may contain predefined Sheet blocks by referencing a **versioned Sheet Definition**.

The default behaviour is to create a new Sheet Instance from that Definition when a Notebook is instantiated.

Other behaviours, such as intentionally referencing an existing shared live Sheet Instance or a pinned snapshot, must be explicit and inspectable.

Templates must not silently own or mutate authoritative scientific data.

### 2.6 Excel familiarity is an interaction goal, not a data model

Sheetbase should support familiar spreadsheet behaviours such as keyboard navigation, copy/paste, fill, formulas, A1 display, range selection, undo/redo, resizing and filtering.

It must not inherit spreadsheet ambiguity where that would undermine scientific data integrity.

Examples:

- column labels are not durable identities;
- A1 coordinates are not semantic identities;
- inserting a governed column is a schema/configuration operation;
- deleting a governed field must respect dependencies and lifecycle;
- bulk paste must be validated at the server boundary;
- calculations must remain reconstructable.

### 2.7 Models are explicit and user-extensible

A Model defines an addressable scientific or business object such as Sample, Reagent, Lentivector, Study, Instrument or Batch.

Models combine protected platform fields with workspace-configured fields. Authorised users can evolve workspace definitions without application developers adding every scientific property.

Schema authority is distinct from Record-edit authority.

### 2.8 Models and Datasets share a schema language

Model fields and Dataset columns do not have to use identical physical PostgreSQL storage, but they share a common semantic field kernel: stable IDs, types, units, constraints, controlled vocabularies, relationships, cardinality and lifecycle.

This allows Sheets, APIs, calculations, filters, Pipelines and future agents to reason about fields consistently.

### 2.9 Configuration is capability-based

Different users require different configuration authority.

A Scientist may create data and add local Sheet columns while being unable to publish a Model or Sheet Definition. A Data Steward may manage Model and Dataset schemas without being a security administrator. A Workflow Builder may author Pipelines without managing users.

Do not collapse all configuration into `member` versus `admin`.

### 2.10 PostgreSQL remains authoritative

Client state, Handsontable state, calculated caches and optimistic updates are projections.

Durable writes must pass the PostgreSQL/API boundary for authentication, authorisation, validation, constraints and audit/event behaviour.

### 2.11 Information density is a product requirement

Sheetbase is for sustained scientific work on information-rich screens.

Default product behaviour should be compact, legible and keyboard-efficient. The main work plane should dominate. Inspectors should reveal contextual detail rather than duplicate the work plane in cards.

Large data must remain performant through virtualisation, incremental loading and server-side operations where appropriate.

### 2.12 AI is assistive and uses normal platform contracts

Future agents do not receive a privileged data path.

Agent-authored changes should resolve to the same typed schema, Record, Dataset, Sheet Definition and Pipeline operations available to humans and code, with normal permissions, validation, provenance and approval policy.

## 3. Core product primitives

### 3.1 Model

Defines a durable type of addressable object. Examples: Sample, Reagent, Lentivector, Study, Instrument, Batch.

### 3.2 Record

One instance of a Model. Records have stable identities and can appear in registries, Sheet cells, Notebook links, relationships, Datasets, storage views, reports and Pipeline inputs/outputs.

### 3.3 Field Definition

A stable semantic definition consumed by Models and Dataset Schemas, including stable identity, type, units, validation, vocabulary, relationship/cardinality and lifecycle semantics.

### 3.4 Dataset

A durable, addressable rectangular data object with an explicit Dataset Schema. It is independent of how it is displayed and independently reusable.

### 3.5 Dataset Schema

Defines the durable columns, types, constraints and relationships for a Dataset using the common Field Definition language.

### 3.6 Sheet Definition

A reusable, versioned definition of how a Sheet should be composed.

A Sheet Definition may own/reference input parameters, expected Dataset Schema or Model compatibility, row identity, joins, column definitions, calculated columns, write-back rules, configured actions and default View references.

A Sheet Definition does **not** own experiment-specific local values or authoritative source Dataset values.

Definitions have durable IDs and explicit versions. Updating a Definition creates a new version; it does not silently alter existing Sheet Instances or pinned Template references.

### 3.7 Sheet Instance

An instantiated Excel-like working Sheet.

A Sheet Instance may be created from a Sheet Definition or created ad hoc and later promoted into reusable configuration where supported.

It owns/references stable identity, exact source Definition/version when applicable, resolved Dataset/Model bindings, Notebook/project context, local fields/values, allowed overrides, lifecycle/provenance and Views.

### 3.8 Sheet Binding

Connects a Sheet Definition or Sheet Instance to a source or input parameter. A Definition may require “a Dataset compatible with Assay Results v2” rather than hard-code one Dataset ID; an Instance resolves that requirement to an actual permitted Dataset.

### 3.9 Sheet Column

A column visible in a Sheet. Initial kinds are `dataset_field`, `model_field`, `relationship`, `local`, and `calculated`. Column identity is independent of display label and visual position.

### 3.10 Row Identity

Defines what one composed Sheet row represents, such as `Sample.id`, `[Sample.id, Timepoint]`, `[Plate.id, Well]`, or a Sheet-local row ID.

### 3.11 View

Saved presentation/query state over a Sheet Instance or Dataset. Views do not change data or Sheet Definition semantics.

### 3.12 Calculation

A deterministic derived value or transformation with durable definition and provenance.

### 3.13 Pipeline / Pipeline Run

A Pipeline is a versioned transformation from declared inputs to outputs. A Pipeline Run is immutable evidence of one execution.

### 3.14 Notebook

The narrative scientific record and context surface. A Notebook can contain prose, protocols, Sheet Instances, Dataset Views, Model/Record links, files, charts, calculations, comments, review state and later Pipeline results.

### 3.15 Notebook Template

A reusable, versioned composition describing Notebook structure.

A Notebook Template may reference versioned Sheet Definitions, protocol definitions, Views and other governed building blocks rather than duplicating them invisibly.

For a predefined Sheet block, the Template specifies an explicit instantiation policy:

- `create_instance` — default; create a new independent Sheet Instance from the pinned Sheet Definition version;
- `reference_shared_instance` — intentionally reference an existing shared live Sheet Instance;
- `pinned_snapshot` — embed a frozen Sheet state for evidence/read-only use.

The default Template → Sheet Definition version policy is **pinned**. Silent automatic upgrade is prohibited.

### 3.16 Policy / Capability

Defines who may read, mutate, configure, publish, instantiate, upgrade, run, approve or administer each class of object/action.

## 4. Reuse and instantiation contract

A reusable Definition may look like:

```text
SheetDefinition: Purification Summary v3

Inputs
  upstream:
    requires DatasetSchema(Upstream Results)
  purification:
    requires DatasetSchema(Purification Results)

Bindings
  samples       -> Model(Sample)
  upstream      -> $upstream
  purification  -> $purification

Row identity
  Sample.id

Columns
  Sample               -> samples.name
  Starting titre       -> upstream.titre
  Final titre          -> purification.titre
  Recovery             -> calculated
  Scientist comment    -> local
```

The same Definition can be referenced by multiple Notebook Templates. Instantiating those Templates normally creates independent Sheet Instances with independently resolved compatible Datasets and independently owned local values.

Publishing `Purification Summary v4` does not silently alter Templates pinned to v3 or existing Instances created from v3. Upgrades require an explicit impact-aware action.

Shared live Sheet Instances remain supported for deliberate cases such as a project Sample manifest, but the shared semantics must be explicit and inspectable.

Pinned snapshots remain available for reconstructable evidence.

## 5. Ad hoc columns and promotion

Sheet-Instance-local columns are first-class because scientific work is exploratory.

A local column may later be promoted, subject to permission and validation, into a Dataset Schema field, Model field, reusable Sheet Definition column, reusable calculated field or Pipeline output where appropriate.

This supports **ad hoc → useful → governed → reusable**.

## 6. Record creation from Sheets

Record creation is a core Sheet Instance capability, not an import workaround. Users can link existing Records, create missing Records inline and bulk-create Records from pasted/selected rows through validated server operations.

A Sheet Definition may configure permitted/default actions; a Sheet Instance executes them through normal permissions and validation.

## 7. Write-back rule

A Sheet Instance may display values from many sources, but **every writable cell has exactly one authoritative write target**.

Ambiguous write-back is invalid configuration. Calculated values are read-only unless explicitly materialised into a governed output.

## 8. Live and snapshot semantics

Every embedded structured object must explicitly identify whether it is live data, a live saved View, a shared live Sheet Instance, a pinned/frozen Dataset/Sheet state, a recorded Calculation/Pipeline result, or part of a submitted immutable Notebook version.

## 9. Product hierarchy

```text
Workspace
├── Models
│   ├── Model Definitions
│   ├── Records
│   └── Relationships
├── Data
│   ├── Datasets / Dataset Schemas
│   ├── Sheet Definitions
│   ├── Sheet Instances / Views
│   └── Calculations
├── Work
│   ├── Projects
│   ├── Studies
│   ├── Notebooks
│   ├── Notebook Templates
│   └── Reviews
├── Automation
│   ├── Pipeline Definitions
│   └── Pipeline Runs
└── Configuration
    ├── Roles / policies
    ├── Vocabularies
    ├── Integrations
    └── Audit / administration
```

## 10. What not to do

Do not:

- make a Sheet Instance equal one physical database table;
- make a Dataset equal one visual grid;
- make a Sheet Definition own experiment-specific local values;
- make a Notebook Template silently own authoritative Sheet/Dataset data;
- silently update existing Sheet Instances when a Definition changes;
- silently update Template dependencies to a newer Definition version;
- assume reuse of a Definition means shared data;
- assume reuse of a Dataset means shared Sheet working state;
- use labels, row positions or A1 coordinates as durable semantic identities;
- create an agent-only mutation path;
- build a visual Pipeline DAG editor before Pipeline Definition/Run semantics exist.

## 11. Definition of the next successful product slice

The next core slice is successful when an authorised scientist can create or select a Notebook; insert a Sheet Instance either ad hoc or from a reusable Sheet Definition; bind multiple Datasets and a Model; define row identity and joins; add local/calculated columns; paste data; link/create Records; write values back correctly; save Views; inspect provenance and Definition/version identity; and reload without hidden client-only truth.

A later Template acceptance slice must prove that one versioned Sheet Definition can be referenced by multiple Notebook Templates, normally producing independent Sheet Instances with independently resolved compatible Datasets/local values, while explicit shared-instance and pinned-snapshot policies behave as declared.
