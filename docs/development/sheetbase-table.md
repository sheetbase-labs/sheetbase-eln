# sheetbase-table integration

Sheetbase renders every editable scientific sheet with
`@sheetbase-labs/sheetbase-table` (COMP-06). The package owns the engine —
selection, editing, in-cell and formula-bar entry, TSV copy/cut/paste,
autofill, undo/redo, local sort/filter, and client formula evaluation. The ELN
never touches the engine directly; it speaks the neutral contract below.

## The wrapper contract

- `SheetbaseGridProps` (`src/components/sheet/sheetbase-grid.tsx`) is the
  caller-facing contract: neutral columns (source + type), rows, per-cell
  state, write callbacks, presentation callbacks and the imperative handle.
- `SheetbaseTableGrid` renders those props through
  `sheetbase-table-grid-client.tsx`, which is loaded lazily so the engine
  bundle is split out of the initial route payload.
- Callers: `canonical-sheet-workspace.tsx` (canonical + ad-hoc sheets) and
  `scientific-sheet-block.tsx` (notebook sheet blocks). They own domain
  behaviour (validation, write attribution, presentation persistence); the
  adapter owns the translation in both directions and keeps every bound write
  keyed by stable record identity.

## Host hooks the adapter uses

- `beforeCellsChange` — the fail-closed typed validation gate (GRID-02/03).
  A rejected change set leaves the inline edit open.
- `onMutation` / `onCellsChange` — audit + persistence, classified by source.
- `customEditors` — the ELN's hosted cell editors:
  - Record columns open the shared search-select Record picker
    (`RecordPickerOpener`); the picked UUID commits through the grid's own
    pre-commit gate.
  - Formula columns (`column.formula`) open
    `FormulaReferenceEditorCell` (`formula-reference-editor.tsx`): in-cell
    `=…` entry, arrow-key/click reference picking with coloured range
    overlays, and function autocomplete from the shared ELN function list
    (`src/lib/function-descriptions.ts`).
- `clipboard` — formula-preserving copy/cut/paste and the GRID-02 cut guard.
- `datasetHeader.fields[].displayText` — stored value → human label without
  rewriting the stored value (Record references, category labels).

## Header chrome (EXP-04.2)

The design's sheet header is driven entirely by neutral column data, so callers
never build engine header settings:

- `SheetbaseGridColumn.group` — the group header naming the column's source.
  Contiguous columns sharing a label render under one header spanning them, so
  the group row follows the displayed order through hide/move.
- `SheetbaseGridColumn.sourceLabel` — the `Source` badge label naming the
  dataset and snapshot (`<dataset> · rev <n>`); absent labels fall back to the
  engine's kind-only badge (`ƒx` for a calculated column).
- `SheetbaseGridProps.appendRow` — the "New run" draft row after the last
  populated row. The canonical workspace passes it only while a run can start
  (a writable, active Sheet), paired with its spare row.

`canonical-sheet-grid.ts` names each column's source: a bound column takes its
Dataset binding's parameter label (plus the composed snapshot revision), local
columns read `This experiment`, and calculated columns read `Derived`.

## Styling

`sheetbase-table/styles.css` is imported in `src/styles.css` before the ELN's
v3 token overrides, so one theme drives the app and the grid. The ELN in-cell
formula editor's own rules live at the bottom of `src/styles.css`.

## Tests

- `src/components/sheet/sheetbase-table-grid-client.test.tsx` — the neutral
  contract mapped onto the engine (props, hooks, clipboard transforms).
- `src/components/sheet/formula-reference-editor.test.ts` — the reference
  picker (A1 helpers, click-drag ranges, keyboard picking, overlays).
- Canonical/ad-hoc workspace suites exercise the surfaces through the neutral
  contract with the grid mocked out.
