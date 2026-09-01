# Handsontable integration

Sheetbase uses Handsontable only for editable scientific sheets. Registry,
queue and read-oriented tables continue to use TanStack Table.

## Licence setup

Sheetbase currently uses Handsontable for a non-commercial demonstration. Its
documented non-commercial/evaluation licence key is explicit local and build
configuration:

```dotenv
VITE_HANDSONTABLE_LICENSE_KEY=non-commercial-and-evaluation
```

The `VITE_` prefix is intentional: Handsontable validates its licence in the
browser, so this value is public build configuration rather than a server-side
secret. The value is included in `.env.example` to make fresh local setup
deterministic. Restart the development server or rebuild the production bundle
after changing it.

Do not reuse this mode if Sheetbase's use becomes commercial. A commercial
deployment must purchase an appropriate licence and override the environment
value without committing the purchased key.

Without a key, Sheetbase renders an explicit unavailable state instead of
initialising an unlicensed grid.

## Integration boundary

- Render grids through `SheetbaseGrid`; do not import the vendor React wrapper
  from notebook or route components.
- `SheetbaseGrid` dynamically imports the vendor bundle after client mount. Its
  loading markup is safe to server-render in TanStack Start.
- The wrapper owns the licence, theme, outer accessible name and keyboard-help
  description. Callers supply Handsontable settings but cannot replace the
  licence or theme.
- Sheetbase theme variables override Handsontable's main theme for typography,
  borders, selection, read-only cells and light/dark application colours.
- Handsontable has richer browser layout and clipboard behaviour than jsdom.
  Unit tests mock the dynamically loaded client boundary; real keyboard,
  selection, copy/paste, fill and virtualisation checks belong in browser tests.

## Keyboard and selection contract

`SheetbaseGrid` owns one spreadsheet-mode contract for canonical ad-hoc,
composed, embedded and read-only Sheets. Callers cannot replace these rules:

- one cell or rectangular range is active; Shift+Arrow extends from its
  anchor; clicking outside the grid deselects it;
- Control/Command-click adds non-contiguous ranges, and the most recently
  added range is active; keyboard extension, copy and cut affect only that
  active range;
- arrows move one cell, Control/Command+Arrow moves to an edge, Home/End moves
  within the row, Control/Command+Home/End moves to a grid corner, and Page
  Up/Page Down moves by the rendered viewport; Shift extends the active range
  for the corresponding selection commands;
- Tab/Shift+Tab moves horizontally. At a horizontal edge it leaves the grid
  through normal page focus order rather than wrapping or trapping focus;
- Enter or F2 starts editing an editable cell. Enter commits and moves down;
  Escape cancels. While an editor is open, text-editor keys act on the editor,
  not the grid selection. Enter on a read-only or derived cell moves down
  without opening an editor;
- Control/Command+A selects all cells, Control+Space selects a column and
  Shift+Space selects a row. Headers remain pointer-operated so keyboard focus
  follows the familiar spreadsheet cell model;
- copy exports the active range's displayed values, including an explicitly
  selected read-only value, but never provenance or write authority. Cut uses
  the active range and fails closed if any cell in it is read-only or derived,
  preventing Handsontable's default partial clear of mixed ranges.

The actual Handsontable `treegrid` carries the product name and keyboard-help
description. Focus stays on the highlighted semantic cell, and the wrapper
draws a visible `focus-within` ring. A blocked cut is announced through a
visible status in a polite live region. Paste, fill, clear and other bulk
range-write guarantees belong to GRID-02 rather than this selection contract.
