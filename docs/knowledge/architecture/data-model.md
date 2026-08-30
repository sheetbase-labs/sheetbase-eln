---
title: Sheetbase Data Model
status: canonical
last_reviewed: 2026-08-30
---

# Sheetbase Data Model

## Identity before presentation

Sheetbase separates semantic identity from presentation.

- Records have stable UUID identity; human identifiers and names are separate.
- Dataset rows and fields have stable identity.
- Sheet coordinates are presentation/local addresses, not durable entity identity.
- Definitions and Templates have their own identities and versions where appropriate.

This prevents renames, sorting, layout changes and UI movement from changing scientific meaning.

## Model and Record

Models define scientific entity types and fields. Records are instances.

Models are user-extensible through the canonical configuration plane and capabilities. They should be used when a scientific thing needs durable entity identity and relationships, not simply because a column has a type.

## Dataset

A Dataset is durable rectangular data.

Canonical expectations:

- typed rows/values;
- stable row and field IDs;
- binding to a Dataset Schema Version;
- live revision/change semantics;
- immutable Dataset Versions for meaningful snapshots/evidence;
- canonical import/export/query APIs.

## Dataset Schema

Dataset Schema Definitions are reusable; Schema Versions preserve historical field interpretation. A Dataset points to its current schema version, while Dataset Versions preserve the schema context required to interpret historical data.

## Sheet

A Sheet is compositional and can combine:

```text
Dataset fields
+ Record references
+ local exploratory fields
+ calculated fields
```

This is a feature, not an architectural compromise.

A Sheet should not require every displayed column to be backed by the same durable source.

## Local fields

Local fields are valid working scientific state. They may be typed and validated but remain local until explicitly promoted.

Promotion should preserve the distinction between historical local work and newly governed structure; promotion does not retroactively pretend an old local column was always organisational schema.

## Calculation

Calculated fields use the canonical calculation/formula architecture. Do not create chart-specific or feature-specific formula engines where the existing calculation representation should apply.

Scientific visualisation transformations are a bounded visualisation pipeline and do not replace the Sheet calculation engine.

## Binding

Binding connects a Sheet to an existing Dataset or reusable Sheet Definition.

Binding should preserve stable field identity. A rename or display-order change should not silently remap a saved scientific meaning.

## Write-back

Write-back must be explicit and unambiguous:

- one target per write operation;
- stable IDs identify rows/Records;
- fail closed when a mapping is ambiguous;
- respect permissions and lifecycle;
- produce canonical revision/provenance effects.

## Promotion

Promotion is a deliberate governance transition, for example:

```text
local Sheet field
   ↓ explicit promotion
Dataset Schema / Model field / reusable Definition
```

Do not auto-promote merely because data has been used more than once.

## Record links and relationships

Relationships use canonical Record links/IDs and remain live context unless specifically pinned by an evidence/versioning rule. Avoid caching labels as authority when stable target identity is available.

## Files

Files are represented through the canonical file subsystem and can be referenced by Records/Notebooks/evidence. Do not introduce a second attachment persistence path.

## Import and external ingestion

Imports and connectors ultimately commit into the same canonical Dataset/Record/Sheet model. Preview, mapping, validation and provenance can differ by ingestion source, but imported data should not become a parallel data class.
