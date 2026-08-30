---
title: Sheet Architecture and Workflow Semantics
status: canonical
last_reviewed: 2026-08-30
---

# Sheet Architecture and Workflow Semantics

## Product role

The Sheet is the primary structured-data interaction surface in Sheetbase. It should feel spreadsheet-native while preserving the scientific identity and provenance of the durable data underneath it.

A Sheet is not required to map one-to-one to one Dataset.

## Composition

A Sheet may compose multiple source types at once:

```text
Dataset A ─┐
Dataset B ─┼─→ Sheet Instance
Records ───┤      + local fields
Relations ─┤      + calculations
           └────→ charts / analysis / Notebook
```

The composition must be explicit enough that Sheetbase can answer:

- where a displayed value came from;
- whether it is writable;
- what object/row would be mutated;
- what relationship/join produced it;
- whether it is local, derived or durable source data.

## Multiple Datasets and Records

A Sheet can combine multiple Datasets and Model/Record data where there is an explicit relationship/join path.

Do not create implicit joins based only on matching labels or human-readable names. Durable joins use stable semantic identity or an explicitly configured relationship.

## Column provenance

Each sourced column should preserve authoritative provenance such as:

- source Dataset/field;
- Record/Model field where applicable;
- local Sheet field;
- calculated/derived field;
- relationship/join context.

Presentation labels can change without changing this meaning.

## Row identity

Spreadsheet row number is visual position, not semantic identity.

Canonical rows/Records need stable IDs. A composed row may represent context assembled from multiple sources, so the product must retain enough source-row/Record identity to support provenance, write-back, collaboration and point inspection.

Stable Sheet row identity remains especially important for future rich Sheet cell/range collaboration anchors.

## Writable vs derived values

A Sheet can show writable source values beside read-only values.

Examples of non-writable values include:

- calculated fields;
- values introduced only by a join when no write target is configured;
- immutable/version evidence;
- source fields the user cannot mutate;
- aggregates/derived analysis.

The UI should make this understandable without requiring users to know the storage model.

## One authoritative write target

Every writable cell/operation must resolve to exactly one canonical mutation target.

If the system cannot determine the target unambiguously, it should fail closed rather than guessing.

Write-back must preserve:

- row/Record stable identity;
- field stable identity;
- permissions;
- validation;
- optimistic concurrency/revision semantics;
- provenance/audit effects.

## Record creation

Record creation is a first-class Sheet workflow.

A scientist should be able to create missing scientific entities while working in the grid, including bulk creation where appropriate. This is not a separate shadow creation mechanism: it uses canonical Model fields, validation, permissions and Record APIs.

A common intended flow is:

```text
paste experiment/sample rows
        ↓
identify missing Record references
        ↓
create canonical Records inline/bulk
        ↓
Sheet cells hold stable Record references
```

## Local fields

Local/ad-hoc columns are legitimate. They allow scientists to explore without modifying organisational schema.

They must remain distinguishable from governed Dataset/Model fields. Promotion is explicit and does not retroactively rewrite historical local meaning.

## Calculated fields

Calculated columns use the canonical calculation/formula architecture. Their values are derived, not an independent durable source of truth.

## Sheet Definition and Instance

Reusable Sheet configuration belongs to Sheet Definition. Actual work belongs to Sheet Instance.

A Definition can describe source composition, fields and reusable behaviour, but existing Instances should not silently change when the Definition evolves.

## Sheets inside Notebooks

Notebook Sheets must support the same canonical composition model rather than becoming a reduced embedded-table subsystem.

A Notebook can therefore combine free-form scientific narrative with serious spreadsheet/data workflows without creating another table abstraction.
