# Sheetbase Core Product Model

> **Status:** Canonical product direction.  
> **Durable decisions:** ADRs 0020–0024.  
> **Read with:** `CORE_ARCHITECTURE.md`, `CORE_MIGRATION.md`, `ROADMAP.md`.

## Product thesis

Sheetbase is a scientific data workspace with an ELN as its contextual record and Excel-like Sheets as its primary structured-data interaction surface.

Scientists should be able to work naturally in Sheets without giving up typed data, durable identities, provenance, APIs, permissions, model governance, reusable configuration or future automation.

## Locked principles

### Notebook context

The Notebook is the narrative scientific record. It embeds/references structured objects but does not become a parallel owner of their data.

### Sheet Definition and Sheet Instance are separate

- **Sheet Definition** — reusable, versioned composition/configuration.
- **Sheet Instance** — actual working spreadsheet state with resolved sources, local values and provenance.

One Definition may be reused by many Notebook Templates and Instances. Reusing a Definition never implies sharing working data.

### Sheet Instances are compositional

A Sheet Instance can combine multiple Datasets and Model Records plus local/ad hoc and calculated columns.

Every displayed value has inspectable provenance. Every writable value has exactly one authoritative write target.

### Datasets are independent data objects

A Dataset belongs to neither a Sheet nor Template merely because it is referenced there. It has mutable live working state and immutable Dataset Versions at meaningful scientific boundaries.

Audit history records individual changes; Dataset Versions identify exact data states used by evidence, publication and Pipelines.

### Dataset Schemas are versioned

Dataset Schemas have stable identity plus explicit immutable versions. Breaking semantic changes require a new version and explicit migration/transformation; stored values are never silently reinterpreted.

### Models have stable identity and evolving fields

A Model such as `Lentivector` remains one durable Model identity. Field Definitions evolve through stable identities and lifecycle/history. Records retain stable identity as Models evolve; historical semantic manifests preserve interpretation.

### Ad hoc means locally governed, not ephemeral

Sheet-local columns are durable, typed data owned by the Sheet Instance. They do not automatically alter bound Dataset/Model schemas.

An ad hoc Sheet Instance (no source Definition yet) is still a durable Instance. It may later become compositional by adding Dataset and Record bindings. It may also be saved as a Definition by extracting reusable structure. Explicit local-field promotion into a Dataset Schema or Model field is a separate, permissioned path — not the only way an ad hoc Sheet becomes governed or compositional.

A useful local field may be explicitly promoted into a reusable Sheet Definition or governed Dataset/Model field with permission, validation and impact handling.

### Templates describe composition, not hidden ownership

A Notebook Template may reference a pinned Sheet Definition version. Normal instantiation creates a new independent Sheet Instance.

Explicit alternatives are deliberate shared-live Instance references or pinned snapshots. Publishing new Definition versions never silently changes Templates or existing Instances.

### Reuse uses composition, not inheritance

Sheet Definitions do not inherit from Sheet Definitions. Notebook Templates do not inherit from Notebook Templates.

If reusable substructures become valuable, use explicit versioned fragments/Template Sections rather than parent-child inheritance.

### Reusable configuration is organisational

Models, Dataset Schemas, Sheet Definitions, Notebook Templates and vocabularies are reusable organisational/tenant configuration objects governed by permissions.

Projects/workspaces contain and organise scientific working data such as Notebooks, Datasets, Records and Sheet Instances.

Do not introduce a package/install system for normal intra-organisation reuse in the Core.

### Workspace lifecycle ownership

Durable scientific working objects have Workspace/tenant lifecycle ownership, not individual-user ownership. Users remain attributable creators/editors.

Archive is normal removal; retirement prevents new use of Definitions while preserving dependants; hard deletion is exceptional and dependency-aware. Immutable evidence blocks normal hard deletion.

### Shared live Sheet Instances are explicit

The same Sheet Instance may deliberately appear in multiple places. The UI must make shared state obvious. Local data belongs to the Instance, so all embeddings see the same local values.

Submitted Notebooks snapshot/pin shared Instance state rather than relying on continuing live evidence.

### Duplication does not imply data duplication

Duplicating a Sheet Instance creates an independent Instance but does not copy bound Datasets or Records. Dataset duplication is a separate explicit action.

### One typed Parameter concept

Sheet Definitions, Notebook Templates and future Pipelines share one typed parameter language. Parameters may flow through compositions rather than being repeatedly requested.

### Presentation state stays lightweight

The Core persists Sheet presentation state such as filters, sorting, column order/visibility/width and freezing. Named reusable Views may be introduced later if useful; they are not a major Core primitive now.

### Calculations have explicit scope

A calculation may be:

1. local to one Sheet Instance;
2. reusable in a Sheet Definition;
3. a governed Dataset Schema derived field.

Promotion between scopes is explicit. Pipelines remain a separate primitive for broader input-to-output transformations.

### Composition is virtual until materialised

Combining sources/calculations in a Sheet does not automatically create a Dataset. Materialisation is an explicit operation that creates a new Dataset with source/calculation provenance and is designed to align with future Pipeline Run semantics.

### PostgreSQL remains authoritative

Handsontable/client state and calculated caches are projections. Durable mutation passes the server/database boundary for authentication, authorisation, validation, constraints and audit behaviour.

### Configuration is capability-based

Data editing, schema configuration, Definition/Template publication, workflow authoring, review and administration are distinct authorities.

### Information density and scale are requirements

Default UI is compact, legible and keyboard-efficient. Large data uses virtualisation/windowed access/server operations rather than assuming complete browser materialisation.

### AI uses normal contracts

Future agents use the same typed operations, permissions, validation, provenance and approval paths as humans/code. There is no agent-only data plane.

## Core objects

### Model / Record / Field Definition

Models define durable scientific/business object types. Records are stable instances. Field Definitions provide shared semantic identity, type, units, validation, vocabulary, relationships/cardinality and lifecycle.

### Dataset / Dataset Schema / Dataset Version

A Dataset is durable rectangular data independent of presentation. Dataset Schemas define typed shape and are explicitly versioned. Dataset Versions freeze exact meaningful data states.

### Sheet Definition

Reusable versioned configuration containing typed parameters/binding requirements, row identity, joins, columns, calculations, write-back rules, actions and presentation defaults.

A Definition never owns experiment-specific local values.

### Sheet Instance

Working Excel-like composition. It records source Definition/version when applicable, resolved bindings, local fields/values, calculations/overrides, presentation state, lifecycle and provenance.

An ad hoc Instance may later become compositional by adding Dataset and Record bindings. It may also be saved as a Definition by extracting reusable structure, parameterising concrete sources and excluding working values. Field promotion is not required for either path.

### Notebook / Notebook Template

A Notebook is scientific narrative/context. A Notebook Template is reusable versioned composition/instructions and may reference pinned Sheet Definition versions.

### Calculation

A deterministic derived value with durable definition and provenance, scoped to Instance, Definition or Dataset Schema as appropriate.

### Pipeline / Pipeline Run

A Pipeline is a versioned broader transformation between declared inputs/outputs. Pipeline Runs are immutable execution evidence and consume immutable input state where required.

### Policy / Capability

Defines who may read, mutate, configure, publish, instantiate, upgrade, run, approve or administer each class of action.

## Reuse example

```text
Organisation
|
+-- Model: Sample
+-- Dataset Schema: Purification Results
+-- Sheet Definition: Purification Summary v3
|       |
|       +-- parameter: purification_results
|       +-- calculation: Recovery
|       `-- local column definition: Observation
|
+-- Notebook Template A --+
|                          +--> Purification Summary v3
+-- Notebook Template B --+

Project
|
+-- Dataset: Run 17 Purification Results
+-- Notebook 001
|    `-- Sheet Instance 91 -- binds Run 17 Dataset
|                             owns local observations
`-- Notebook 002
     `-- Sheet Instance 92 -- may bind same/different Dataset
                             owns independent local observations
```

## Save as Definition

```text
Useful ad hoc Sheet Instance
        |
        | Save as Definition
        v
extract reusable structure
parameterise concrete sources
exclude working/local values
        |
        v
new Sheet Definition version
```

## Definition upgrade

Upgrading an Instance is explicit and data-preserving. It conceptually compares the original Definition version, Instance changes and target Definition version. Conflicts require resolution; Instance-owned data is never silently discarded.

## Record creation from Sheets

Sheet Instances support linking existing Records, creating Records inline and bulk creation from pasted/selected rows through validated server operations.

## Frozen evidence

Submitted evidence must reconstruct exact relevant state, including immutable Dataset Versions, Model/Field semantic manifests, Sheet Definition versions, Sheet Instance snapshots/local values and Calculation evidence.

## What not to do

Do not:

- equate Sheet Instance with a database table;
- equate Dataset with a visual grid;
- make Templates/Definitions own experiment-specific values;
- silently upgrade Templates or Instances;
- use Definition/Template inheritance;
- make ad hoc/local values client-only;
- silently promote local fields/calculations;
- infer compatibility only from labels;
- automatically materialise Sheet composition;
- make named Views a prerequisite for the Core;
- hard-delete objects needed by immutable evidence;
- create an agent-only mutation path.
