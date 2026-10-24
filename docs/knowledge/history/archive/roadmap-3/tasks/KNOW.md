# KNOW — Scientific Knowledge & Relationship Context

**Status (2026-09-07):** KNOW-01..03 implementation merged on `main` (#130..132). See the [reconciled status index](README.md); merged is not independent acceptance of every exit. Current assignment is owned by [`../../NEXT.md`](../../../../NEXT.md).

## Programme goal

Make scientific relationships and lineage visible and useful without creating a parallel knowledge graph authority.

## KNOW-01 — Relationship Exploration

### Goal

Expose canonical Record, Dataset, Notebook, Sheet, file and provenance relationships as navigable scientific context.

### Scope

- relationship panels and incoming/outgoing links;
- typed relationship labels and lifecycle state;
- permission-aware traversal;
- stable IDs and canonical targets.

### Exit

Users can inspect how a scientific object relates to other canonical objects and navigate those relationships reliably.

## KNOW-02 — Lineage & Provenance Views

### Goal

Provide understandable lineage from source data through calculations/analysis to evidence.

### Scope

- Dataset/source/materialisation lineage;
- Sheet column/value provenance summaries;
- figure/analysis source tracing;
- submitted/frozen evidence linkage;
- bounded graph/list representations suitable for real work.

### Exit

A user can trace consequential scientific outputs back to authoritative sources and versions without inspecting raw database/audit records.

## KNOW-03 — Relationship Quality & Contextualisation

### Goal

Improve the usefulness and integrity of relationship data.

### Scope

- relationship validation and duplicate/ambiguous-link handling;
- useful scientific relationship metadata where justified;
- related-object summaries and counts;
- performance for relationship-heavy objects;
- API/SDK parity for canonical relationship reads.

### Exit

Relationship context is reliable, performant and available through the same canonical domain contracts used by the UI.

## Boundaries

- Do not create a second graph database as product authority.
- Do not infer durable scientific relationships from labels alone.
- Historical provenance/evidence semantics must remain immutable where pinned.
