# ADR 0020 — Separate Sheet Definitions, Sheet Instances and Template References

**Status:** Accepted  
**Date:** 13 August 2026

## Context

Sheetbase Sheets must eventually satisfy several distinct reuse cases:

- a Notebook Template can contain predefined Sheets;
- multiple Notebook Templates can reuse the same Sheet configuration;
- the same Dataset can appear in many different Sheets and Templates;
- many Notebook instances can be created from one reusable Sheet design while retaining independent local/ad hoc values;
- some use cases deliberately embed the same live Sheet in multiple places;
- controlled/reviewed use requires pinned/frozen Sheet state;
- reusable Sheet structures may bind to different compatible Datasets when instantiated;
- future Pipelines may produce a Dataset that is then presented through a reusable Sheet configuration.

Treating all of these as a single `Sheet` object would conflate reusable configuration with instantiated scientific work and make Template ownership, versioning, local values and reuse ambiguous.

## Decision

Sheetbase will distinguish **Sheet Definition** from **Sheet Instance**.

### Sheet Definition

A `SheetDefinition` is a reusable, versioned configuration describing how a Sheet is composed.

It may define:

- named/typed input bindings or parameters;
- expected Dataset Schemas or Model targets;
- row identity;
- constrained joins;
- column definitions;
- calculated columns;
- write-back rules;
- configured Record/data actions;
- default View/presentation references where appropriate.

A Sheet Definition does **not** own experiment-specific local values or authoritative scientific source data.

### Sheet Instance

A `SheetInstance` is an instantiated working Sheet.

It may reference:

- the Sheet Definition and exact Definition version it was created from;
- resolved Dataset/Model bindings;
- Notebook/project context;
- instance-local fields and values;
- allowed instance overrides;
- Views;
- lifecycle/provenance.

Existing instances remain bound to the Definition version from which they were created unless an explicit upgrade/migration operation is performed.

### Dataset independence

Datasets are independent objects. Neither Sheet Definitions, Sheet Instances nor Templates own a Dataset merely because they reference it.

The same Dataset may be used by many Sheet Definitions and Sheet Instances, subject to permissions and version/live policy.

### Notebook Template references

A Notebook Template may contain a Sheet block that references a **versioned Sheet Definition** and an explicit instantiation policy.

Initial conceptual policies are:

1. `create_instance` — default. Create a new independent Sheet Instance from the referenced Definition version.
2. `reference_shared_instance` — deliberately embed/reference the same existing live Sheet Instance.
3. `pinned_snapshot` — embed a frozen/pinned Sheet state for evidence/read-only use.

A Template does not own the authoritative Sheet Instance unless it explicitly references an independently existing shared instance. Ordinarily, it owns instructions for creating one.

### Version policy

Template references to Sheet Definitions are pinned to an explicit Definition version by default.

A future `follow_latest_compatible` policy may be supported, but silent automatic upgrade is not the default.

When a newer Definition version exists, the product should support an impact-aware update workflow rather than mutating Templates or existing Sheet Instances implicitly.

### Parameters and resolved bindings

A Sheet Definition may define binding parameters rather than hard-coding one specific Dataset instance.

Example:

```text
SheetDefinition: Assay Results Review v3

Inputs
  results_dataset:
    requires schema: Assay Results v2

Bindings
  results -> $results_dataset
  samples -> Model(Sample)
```

A Notebook Template or user instantiating the Sheet resolves `results_dataset` to an actual compatible Dataset.

This allows one Sheet Definition to be reused across experiments and Templates without duplicating structure or coupling the Definition to one Dataset instance.

## Consequences

### Positive

- Notebook Templates can safely contain predefined Sheets.
- Multiple Templates can reuse the same Sheet Definition.
- Multiple Sheets can reuse the same Dataset.
- Experiment-specific local data does not leak into shared configuration.
- Existing scientific work remains reconstructable when a Definition evolves.
- Template updates become explicit dependency/version updates.
- Pipelines can remain Dataset-oriented and instantiate/present outputs through Sheet Definitions independently.
- Shared live Sheets remain possible, but only through explicit semantics.

### Costs

- The object model gains one additional first-class distinction.
- Definition versioning and instance upgrade semantics must be implemented.
- Template block configuration needs instantiation/version policy.
- Dependency/impact analysis must account for Definition → Template/Instance relationships.

These costs are accepted because the alternative creates ambiguous ownership and unsafe implicit propagation.

## Invariants

1. A Sheet Definition never owns experiment-specific local values.
2. A Sheet Instance records the exact Definition version it was created from when applicable.
3. Existing Sheet Instances do not silently change when a Definition is updated.
4. Notebook Templates reference versioned Definitions or explicit existing shared Instances; they do not implicitly own authoritative Sheet data.
5. Datasets remain independently addressable and reusable.
6. Reusing a Definition does not imply sharing Sheet-local values.
7. Reusing a Dataset does not imply sharing a Sheet Instance.
8. Shared live-instance behaviour is explicit and inspectable.
9. Frozen/pinned behaviour is explicit and reconstructable.
10. Definition parameters may constrain compatible inputs by schema/model semantics rather than hard-coded IDs.

## Example

```text
SheetDefinition: Purification Summary v3
  inputs:
    upstream: DatasetSchema(Upstream Results)
    purification: DatasetSchema(Purification Results)
  model binding:
    samples: Model(Sample)
  columns:
    Sample
    Starting titre
    Final titre
    Recovery
    Observation (local)

NotebookTemplate A ──┐
                     ├── Purification Summary v3
NotebookTemplate B ──┘

Template A → Notebook 001 → SheetInstance 91
Template A → Notebook 002 → SheetInstance 92
Template B → Notebook 003 → SheetInstance 93
```

Instances 91–93 can bind to the same or different compatible Datasets, but their local values and working lifecycle remain independent unless an explicit shared-instance policy was chosen.

## Rejected alternative

### One `Sheet` object used as both reusable definition and working instance

Rejected because it makes Template reuse ambiguous, risks accidental sharing of local data, complicates Definition upgrades, and conflates configuration dependencies with scientific working state.
