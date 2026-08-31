# GRID — Spreadsheet Interaction Depth

**Status:** active; GRID-01 in review (#99), GRID-02 and GRID-03 implemented on the same stack, GRID-04..05 planned.

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

## GRID-03 — Typed Editing & Validation UX

**Status:** completed 2026-08-31.

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

### Implemented contract

- **Single typed edits fail closed like bulk writes.** The workspace
  `beforeChange` guard now validates every write source — keyboard edits
  included — against the typed column contract via
  `resolveCanonicalCellChanges`. An invalid value cancels the change, so the
  cell visibly keeps its previous value and the canonical reason
  (`invalid_value`, `required_value`, …) is announced with the column label;
  the visible grid never diverges from the authoritative state. The
  GRID-02 bulk verbs (paste/fill/clear) keep their wholesale rejection.
- **Editor output is coerced to canonical values before it is applied.** The
  same resolution pass rewrites Handsontable's change values through
  `parseSheetCellInput`, so the grid shows what will be written: category
  labels/keys resolve to the canonical option id, bare date-time input
  (with or without seconds, space or `T` separator) becomes a canonical UTC
  instant, and unambiguous thousands-separated clipboard numbers
  (`1,200.5` → `1200.5`) coerce. Ambiguous input is left untouched and
  fails closed at validation; no coercion invents new rules beyond the
  existing canonical parse contract.
- **Category columns use the canonical vocabulary.** The dropdown editor is
  seeded from the field's active embedded option labels; a display-only
  renderer shows stored option ids as their labels. Vocabulary-backed
  fields without a local option list keep a text editor. The server (and
  the shared local validator) remains the vocabulary authority — retired
  options and unknown text are still rejected, never remapped.
- **Date/time columns edit safely.** `date` fields edit through the
  Handsontable date editor (`YYYY-MM-DD`). Timestamp fields deliberately
  keep the text editor: Handsontable 18's `date` cell type is a native
  date-only input that cannot hold a time and rejects canonical `…Z`
  instants, which would make timestamp columns uneditable. Bare timestamp
  input is coerced to a canonical UTC instant on commit because the grid
  carries no timezone context (deterministic and user-independent;
  explicit offsets pass through). Numeric, boolean and Record/reference
  columns keep their existing GRID-01/02 behaviour.
- **Rejections do not pollute undo.** Every rejected change nullifies its
  Handsontable change entries before cancelling, so the undo stack never
  records a no-op step whose Ctrl+Z would re-persist unchanged values.
- **Category editing opens on the label.** The dropdown editor seeds its
  text input with the display label for the stored option id; picking a
  label coerces back to the canonical id.
- **Quantity columns surface their storage unit.** Column headers show the
  field's canonical `storageUnit` (for example `Titer (IU/mL)`). This is
  display only: no client-side unit conversion exists, so input units are
  never silently translated.
- **Server validation remains authoritative.** The client affordances only
  pre-screen through the existing `sheetLocalValueError` /
  `validateCanonicalCell` contract and the GRID-02 bulk
  validate-before-commit path (`validate_dataset_row_batch`); no new
  client-side validation rules were added, and GRID-04/GRID-05 behaviour is
  untouched.

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
