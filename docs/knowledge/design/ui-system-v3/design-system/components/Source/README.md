# Source and diff

**Source** says where a column or value comes from. It sits under a sheet column header, in an inspector, or beside a value in a record.

- `Sheetbase.Source` with `kind`:
  - `dataset`: read from a dataset snapshot; the label names the dataset and snapshot, e.g. "DS-0311 · S-15". Read-only in a sheet.
  - `record`: a linked record, such as a material or instrument.
  - `calc`: calculated in place; label "ƒx".
  - `local`: exists only in this sheet. Drawn in accent, because it is the one kind that can't be cited or read by a pipeline until promoted.
- Class `.src` (plus `.local`) for plain markup.

**Diff** shows one value before and after: `Sheetbase.Diff` with `before` and `after`. Omit `before` for an added value. It renders `del` and `ins`, which stay legible without colour (strike-through and underline). Use it in snapshot comparisons, evidence versus live, record history and template updates. For a whole row or section, use a `Tag` instead.
