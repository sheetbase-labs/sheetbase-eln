# CORE-03 — Compositional Sheet

**Status:** Planned / task skeletons  
**Refinement gate:** CORE-02.8 must expand these tasks to implementation-ready detail using the implemented Dataset contracts.

## Epic goal

Evolve the existing scientific Sheet into an Excel-like composition over one or more Datasets and Model Records plus local and calculated columns, with explicit row identity, provenance and write-back.

## Non-negotiable constraints

- preserve existing Excel-like Handsontable interaction and HyperFormula trust/provenance work;
- a Sheet is not one Dataset;
- every source is an explicit binding;
- row identity is explicit;
- joins are constrained and cardinality-aware;
- every writable value has exactly one authoritative target;
- local values are durable, typed data, not React/Handsontable-only state;
- calculations bind to stable semantic identities beneath A1 presentation;
- large-source behaviour must not require full browser materialisation by default.

## Planned tasks

### CORE-03.1 — Audit current Sheet persistence and interaction contracts

Map current Sheet block/table persistence, schema configuration, Handsontable integration, workbook/formula binding, save coordination and API behaviour to the target Sheet object.

**Output:** `docs/core/audits/SHEET_COMPOSITION_AUDIT.md` and exact migration/refactor map.

### CORE-03.2 — Introduce durable Sheet, Binding and View identities

Create the minimal Sheet metadata object and explicit Dataset/Model bindings while preserving existing single-source Sheet behaviour as the first compatibility path.

**Exit concept:** an existing scientific Sheet can be represented as a Sheet with one Dataset binding rather than special legacy semantics.

### CORE-03.3 — Implement row identity

Support source, composite and local row-identity specifications. Validate uniqueness/determinism and use stable identities for local values, joins and write-back.

**Do not:** use visible row position as durable identity.

### CORE-03.4 — Implement constrained multi-source joins

Start with explicit equality joins and cardinality expectations. Detect ambiguous/unexpected many-to-many expansion rather than silently multiplying rows.

**Exit concept:** Sample Model + two Datasets can compose by Sample ID.

### CORE-03.5 — Implement bound Dataset/Model columns and provenance inspection

A Sheet column can project Dataset fields, Model fields and relationships while retaining source identity. Column headers/inspector should allow users to discover source/write target without cluttering every cell.

### CORE-03.6 — Implement durable local columns

Support typed Sheet-local fields and values associated with composed row identity. Preserve API/audit semantics and design for later promotion into governed schemas.

### CORE-03.7 — Adapt calculations to composed Sheets

Ensure formulas operate over the composed grid while dependencies resolve to stable Sheet/source identities. Preserve current deterministic function profile and calculation evidence.

**Do not:** persist A1 coordinates as the semantic dependency key.

### CORE-03.8 — Implement explicit write-back

Route edits from bound Dataset fields, Model fields and local fields to exactly one authoritative target. Calculated fields remain read-only unless an explicit materialisation operation exists later.

**Exit concept:** editing a displayed value never leaves the system guessing which source should change.

### CORE-03.9 — Separate saved View state

Persist filters, sorts, grouping, widths/order/visibility/freeze/density as View/presentation state rather than Dataset/field semantics. Prepare for user/team defaults.

### CORE-03.10 — Multi-source golden workflow proof

Demonstrate a Notebook Sheet combining:

- Sample Records;
- Upstream Results Dataset;
- Purification Results Dataset;
- local Observation;
- calculated Recovery.

Prove reload, provenance, correct write-back, filter/sort/View state and representative performance.

**Hand-off:** refine CORE-04 tasks and move `NEXT.md` only after the exit gate passes.

## Epic exit gate

One Sheet combines at least two Datasets plus a Model and local/calculated columns, with explicit row identity/joins, stable formula semantics, durable local data, correct write-back, saved View separation and reconstructable provenance.
