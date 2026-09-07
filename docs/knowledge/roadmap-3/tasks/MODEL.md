# MODEL — Scientific Modelling Depth

**Status (2026-09-07):** MODEL-01..04 implementation merged on `main` (#137..140). See the [reconciled status index](README.md); merged is not independent acceptance of every exit. Current assignment is owned by [`../../NEXT.md`](../../NEXT.md).

## Programme goal

Deepen how scientists model domain concepts while keeping the existing Model/Record and FieldDefinition systems canonical.

## MODEL-01 — Model Authoring Experience

### Goal

Make creation and evolution of scientific Models clear, immersive and safe for Stewards.

### Scope

- field structure/type/validation authoring;
- rich preview of how Records and Sheet references will behave;
- lifecycle/version impact visibility;
- dependency awareness before publish/retire changes.

### Exit

A Steward can design and evolve a realistic scientific Model without using raw configuration forms or creating ambiguous downstream effects.

## MODEL-02 — Scientific Field Semantics

### Goal

Expand reusable scientific field semantics where real workflows require them.

### Scope

- quantities/units and controlled categories using canonical vocabularies;
- Record/reference semantics;
- structured identifiers and constrained text where justified;
- shared validation contract across Record, Sheet and public clients.

### Exit

Common scientific field semantics can be expressed once and behave consistently across Records, Sheets, imports and APIs.

## MODEL-03 — Model Relationships & Constraints

### Goal

Support richer explicit relationships between scientific entities.

### Scope

- typed Record relationships and cardinality/constraint semantics where needed;
- creation/linking UX;
- RLS and lifecycle handling;
- query/navigation integration with KNOW.

### Exit

Scientists can represent important entity relationships explicitly without relying on free-text IDs or label joins.

## MODEL-04 — Model Evolution & Impact Analysis

### Goal

Make schema/model evolution understandable and dependency-aware.

### Scope

- impact analysis for definitions, Sheets, templates and Records;
- explicit upgrade/migration semantics where existing contracts require them;
- archive/retire behaviour;
- no silent reinterpretation of historical evidence.

### Exit

A Steward can change a Model with a clear view of affected consumers, and historical/pinned scientific meaning remains stable.

## Boundaries

- Extend canonical Models/Records/FieldDefinitions; do not add a parallel ontology/model subsystem.
- Typing an ad-hoc Sheet field does not auto-create Model schema.
- Promotion remains explicit.
