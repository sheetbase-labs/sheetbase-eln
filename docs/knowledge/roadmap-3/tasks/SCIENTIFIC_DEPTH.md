# Roadmap 3 Tasks — Scientific Depth

## Programme outcome

Make Sheetbase increasingly useful as a scientific knowledge/work platform by deepening relationships, representations, modelling and reuse on top of the canonical Core data model.

---

## KNOW-01 — Scientific Knowledge & Relationship Context

### Problem

Scientific work is connected: samples derive from materials, assays produce results, datasets relate to records, notebooks reference methods and analyses. Those relationships should be navigable and inspectable without inventing a separate graph product or ontology authority.

### Scope

- expose canonical Record/Dataset/Sheet/Notebook relationships consistently;
- relationship-aware context panels and navigation;
- lineage/derivation views grounded in stored stable identities/provenance;
- inspect upstream/downstream references and use sites;
- relationship creation/editing only through canonical supported relationship contracts;
- visual graph views where they materially help understanding.

### Non-goals

- generic knowledge graph platform;
- inferred scientific facts presented as authoritative;
- a second relationship store;
- resurrecting retired scientific-table schema relationships.

### Dependencies

NAV-01; canonical identities and provenance from Roadmaps 1–2.

### Required evidence

- DB/API tests for relationship isolation and lifecycle;
- UI traversal tests across representative scientific objects;
- lineage reconstruction from canonical provenance;
- no relationship semantics encoded only in UI state.

### Exit criterion

Scientists can inspect and navigate meaningful scientific relationships and provenance across canonical Sheetbase objects, including upstream/downstream context, without a parallel graph authority.

---

## VIEW-01 — Rich Scientific Representations

### Problem

Not every scientific object is best understood as a generic table or card. Sheetbase needs richer representations that remain views over canonical data rather than new storage models.

### Scope

- define a view/representation contract for domain-specific visualisations over Models, Records, Datasets and Sheets;
- support high-value scientific representations such as plate layouts, timelines, lineage/process flows, distributions and relationship views where justified;
- reuse ChartSpec for quantitative charts rather than creating chart-specific alternatives;
- persist view configuration separately from scientific source data;
- allow live/frozen evidence-aware representations where applicable;
- make representation choice composable in Notebook/Record/Dataset contexts.

### Non-goals

- one-off page components with hidden data semantics;
- domain-specific storage tables for each representation;
- replacing Sheet/Notebook as the primary work surfaces;
- silently sampling analysis data for display convenience.

### Dependencies

SCI-04 complete; GRID-01 recommended; KNOW-01 for relationship-heavy views.

### Required evidence

- deterministic materialisation from canonical sources;
- live/frozen parity where evidence is supported;
- view configuration round-trip tests;
- performance/display-limit tests distinct from analysis limits.

### Exit criterion

Sheetbase can render and persist multiple scientifically useful representations of canonical data without duplicating source state, and the same source can move between appropriate views predictably.

---

## MODEL-01 — Scientific Modelling Depth

### Problem

User-extensible Models and schema concepts exist, but mature scientific work needs richer modelling without forcing every organisation into hard-coded biotech entities.

### Scope

- deepen Model field semantics using the canonical FieldDefinition kernel;
- richer typed relationships/reference fields where current canonical contracts support them;
- quantities/units/vocabularies integration using existing decisions rather than duplicate systems;
- calculated/derived properties where provenance and deterministic evaluation are clear;
- improved schema/model authoring UX for Stewards;
- explicit lifecycle/version/evolution behaviour;
- ensure Records, Sheet references, SDKs and automation all consume the same model definition.

### Non-goals

- fixed biotech ontology shipped as mandatory product structure;
- schema inheritance hierarchy;
- auto-promotion of exploratory Sheet fields;
- a separate SDK-only schema language;
- reopening settled Dataset Schema vs Model distinctions without evidence.

### Dependencies

Roadmap 1 schema kernel, Models/Records and Roadmap 2 Steward configuration; relevant ADRs.

### Required evidence

- model evolution/version tests;
- Record validation parity across browser/API/SDK paths;
- Sheet reference/write-back tests for richer fields;
- permission tests for Steward vs ordinary scientist configuration.

### Exit criterion

Stewards can model richer scientific entities and relationships through one canonical configurable system, and those semantics are honoured consistently by Records, Sheets, APIs and automation.

---

## REUSE-01 — Reusable Scientific Structures & Workflows

### Problem

Sheet Definitions and Notebook Templates provide reuse, but mature teams need a coherent way to reuse successful scientific structures without hidden inheritance or accidental shared mutable state.

### Scope

- deepen reusable combinations of Notebook Templates, Sheet Definitions, Models, Dataset Schemas, parameters and canonical Pipelines;
- explicit package/composition of reusable structures without creating another workflow engine;
- clear pin/upgrade semantics for every reusable dependency;
- preview/diff before upgrades;
- explicit extraction of reusable structure from working science where appropriate;
- improve discovery and ownership of reusable structures;
- preserve independent instances unless shared-live behaviour is explicitly chosen by existing contracts.

### Non-goals

- implicit inheritance trees;
- silent upgrades;
- copying governed source data when duplicating structure;
- second Pipeline model;
- turning Templates into mutable shared documents.

### Dependencies

MODEL-01 and NOTE-01 recommended; existing Definition/Template/Pipeline version contracts.

### Required evidence

- instantiate/pin/upgrade/diff tests;
- no accidental shared local state between instances;
- parameter validation through canonical contracts;
- workflow acceptance using at least one realistic multi-object scientific pattern.

### Exit criterion

A team can capture, discover, instantiate and deliberately upgrade reusable scientific structures that combine existing canonical configuration primitives, with stable version semantics and no hidden shared state.
