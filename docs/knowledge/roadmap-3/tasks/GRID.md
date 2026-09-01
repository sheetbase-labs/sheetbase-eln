# GRID — Spreadsheet Interaction Depth

**Status:** active; GRID-01 in review (#99), GRID-02 implemented on the same stack, GRID-03..05 planned.

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

### Implemented contract

- **Paste and fill fail closed at the wrapper.** The grid wrapper owns a
  `beforeChange` guard: `CopyPaste.paste` and `Autofill.fill` are rejected
  outright when any target cell is read-only or derived, with the reason
  announced through the grid's `aria-live` status region. Partial writes that
  silently skip guarded cells are avoided; keyboard edits keep their existing
  per-cell semantics.
- **Bulk writes are type-checked before the grid changes.** The composed
  Sheet validates paste/fill change sets against the typed column contract
  (`firstBulkChangeRejection`): an out-of-type value cancels the whole
  operation with a named-column reason, so the visible grid can never diverge
  from the authoritative state over an invalid bulk write.
- **Clear contents routes through the edit pipeline.** The composed-sheet
  context menu gains "Clear contents" over the selection; cleared cells are
  written as nulls through the same parse → validate → authoritative-target
  path as typed edits, so required fields keep their values, derived columns
  are skipped, and bound cells still flow through the explicit Write-back
  commit.
- **Bulk validation precedes the authoritative commit.** `writeSheetCells`
  calls `validate_dataset_row_batch` with the exact grouped batch before each
  `commit_dataset_row_batch`; a rejected batch raises
  `SheetBatchValidationError`, the commit never runs, and the workspace
  reports the canonical failure reason with the assurance that nothing was
  written.
- **Mixed-authority range operations are rejected before any write.**
  `writeSheetCells` dispatches its commit groups sequentially with no
  cross-group atomicity, so a change set spanning more than one commit group
  (multiple (dataset, expected revision) groups, multiple records, or a mix
  of dataset, record and local targets) raises
  `SheetMixedAuthorityWriteError` (`mixed_authority_write`) before any RPC
  runs. The workspace reports that the operation was not attempted and keeps
  the pending values so the edit can be split per authoritative surface;
  single-group batches keep their existing validate-then-commit semantics.

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
