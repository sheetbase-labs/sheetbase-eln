# Sheet grid

A real spreadsheet surface backed by a schema, not a table of inputs. 28px rows, cell borders in `grid-line`, row numbers, frozen headers.

- `.g` on the table. `.cell-active` draws the 2px accent outline; `.cell-invalid` the error wash; `.der` marks calculated columns, with a `.fx` badge in the header.
- Group headers name each column's source dataset. Validation detail and provenance appear in the inspector for the active cell.
- Keyboard: arrows move, Enter edits and saves a row, Esc discards, Tab moves right.
