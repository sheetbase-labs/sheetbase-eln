---
title: Evidence and Versioning
status: canonical
last_reviewed: 2026-08-30
---

# Evidence and Versioning

## Principle

Version only where scientific meaning, reusable published configuration or evidence requires it.

Sheetbase deliberately avoids a universal “version every object” architecture.

## Live state vs immutable state

### Live

Examples include:

- active Datasets;
- Sheet Instances;
- working Notebooks;
- draft Definitions/Templates;
- live charts/analyses.

These can evolve through canonical revision/concurrency rules.

### Immutable meaningful state

Examples include:

- Dataset Versions;
- published Definition/Template versions;
- submitted Notebook/revision evidence;
- frozen visualisation evidence pinned to Dataset Version and configuration.

These preserve historical interpretation.

## Dataset Versions

Dataset Version is the canonical immutable structured-data snapshot.

It is preferred over inventing a generic Sheet Version because a Sheet is an interaction/composition surface that can include local and presentational state. Evidence can pin the durable data that gives the scientific result meaning without pretending every UI state needs its own historical object.

A Dataset Version must retain enough schema-version context to interpret its fields later.

## Definitions and Templates

Reusable Definitions/Templates are versioned where changing configuration would otherwise silently change existing consumers.

Instantiation/reuse does not create shared mutable state. Existing instances do not silently upgrade when a new Definition/Template version is published.

Where upgrades are supported, they are explicit.

## Notebook revisions and submission

A submitted Notebook/revision is an evidence boundary. Submission captures/pins the scientific state required to reproduce the record while allowing live sources to continue evolving separately.

Electronic-record operations such as submit, sign and amend remain intentional human-session operations where attestation is required; they are not casually exposed through service credentials.

## Frozen visualisation

After SCI-04, frozen scientific visualisation semantics are:

```text
ChartSpec
   +
pinned Dataset Version
   ↓
same deterministic materialisation pipeline used by live rendering
   ↓
frozen scientific meaning
```

The frozen artefact preserves referenced field metadata and provenance. Later live Dataset edits change live figures but not the reconstructed frozen evidence.

The live/frozen distinction is a product invariant, not a compatibility shim.

## Historical interpretation

Canonical evidence created under the current product model must not be silently reinterpreted by later schema, Dataset, Definition, Template or display changes.

This does not imply preserving superseded pre-release contracts. Development-era compatibility can be removed while intentional evidence semantics remain strict.

## Audit vs evidence

Audit history and frozen evidence are different:

- **audit/history** records who changed what and when;
- **evidence** preserves the scientific state/meaning required for a record or conclusion.

An audit log alone is not a frozen scientific artefact.

## Provenance

Evidence should retain stable references and explicit scientific configuration rather than duplicate arbitrary raw data everywhere.

For example, a figure should retain source Dataset/Version, field mappings, filters, transformations, summary/error semantics, fit method/parameters and evidence binding as required to reproduce its meaning.
