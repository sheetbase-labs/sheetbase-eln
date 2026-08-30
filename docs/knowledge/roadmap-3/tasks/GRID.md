# GRID — Spreadsheet Interaction Depth

**Status:** planned; not active until promoted by `docs/knowledge/NEXT.md`.

## Programme goal

Make Sheets feel genuinely spreadsheet-native while preserving typed data, provenance, permissions and explicit write targets.

## GRID-01 — Keyboard & Selection Model

### Goal
Establish a complete, predictable spreadsheet keyboard/selection contract.

### Scope
- cell/range selection, extend selection and multi-range rules;
- arrows, Enter, Tab, Home/End, Page navigation and shortcuts;
- edit-vs-navigation mode consistency;
- copy/cut selection semantics and accessible focus.

### Exit
A spreadsheet-proficient user can navigate and select realistic Sheets without reaching for the mouse for routine operations.

## GRID-02 — Clipboard, Fill & Range Operations

### Goal
Support high-volume direct manipulation expected from spreadsheets.

### Scope
- copy/cut/paste across cells/ranges;
- fill handle and fill series where type-safe;
- insert/delete/clear operations;
- bulk validation before authoritative writes;
- preserve provenance and one-write-target semantics.

### Exit
Common range operations work predictably over local, governed and read-only/derived columns and fail closed when an operation has no unambiguous write target.

## GRID-03 — Typed Editing & Validation UX

### Goal
Make typed scientific data entry fast without hiding data semantics.

### Scope
- editors for numeric, date/time, boolean, category, quantity and Record/reference fields;
- inline validation/error recovery;
- units/vocabulary affordances;
- bulk paste coercion with explicit failures;
- canonical server validation remains authoritative.

### Exit
Users can enter and correct typed data efficiently, with client feedback matching server/domain validation rather than creating a second rules engine.

## GRID-04 — Sort, Filter, Freeze & View Ergonomics

### Goal
Make large working Sheets practical to inspect and organise.

### Scope
- multi-column sort/filter UX;
- frozen rows/columns where supported by canonical presentation state;
- column sizing/reordering/hiding;
- saved presentation/view state without mutating underlying Dataset meaning;
- clear distinction between presentation filtering and scientific analysis filtering.

### Exit
A user can configure and restore a useful working view of a large Sheet without changing the Dataset or analysis semantics accidentally.

## GRID-05 — Large-Sheet Performance & Reliability

### Goal
Keep spreadsheet interaction responsive at realistic product limits.

### Scope
- profile render/edit/filter/paste paths;
- virtualisation and incremental loading where appropriate;
- avoid silent truncation or sampling of editable/scientific state;
- conflict/retry behaviour under concurrent change;
- measurable performance budgets.

### Exit
Published performance scenarios meet explicit interaction budgets and no optimisation changes scientific meaning, write-back identity or evidence reconstruction.

## Boundaries

- One Sheet product; do not split ad-hoc/composed Sheets into separate products.
- Row position is not semantic identity.
- Display optimisation must never silently become analysis sampling.
- Do not move canonical validation or permission authority into Handsontable/client state.
