# COMP — Sheetbase Components in the ELN

**Status (2026-09-27):** Proposed; not assigned. Work happens in both repositories: `sheetbase-labs/sheetbase-components` (packages) and this one (integration). Changing the packages is in scope; they are changed at source to fit v3, not overridden from the ELN.

## Programme goal

The ELN's grids, charts and filter builder run on our own
`sheetbase-components` packages, styled exactly as UI system v3, replacing
Handsontable and Recharts.

## Baseline

**`sheetbase-components` (`main`, `24a53c3`):** Bun workspace with
`sheetbase-shared` (field and query contracts, theme variables scoped to
`.sheetbase-scope`), `sheetbase-table` (virtualised spreadsheet with its own
formula engine, bound record-field writes, paging, conditional formatting,
configurable sections), `sheetbase-explorer` (chart-first exploration),
`sheetbase-advanced-search`, `sheetbase-schemaeditor`,
`sheetbase-rulesengine`. The packages have their own design direction (violet
interaction colour, Instrument Sans 12px UI text, Roboto Mono, 31px rows).
`sheetbase-table` CSS contains about 500 literal colour values against 93
variable uses; row height is a constant (`ROW_HEIGHT = 31`). A release flow to
npm exists but nothing has been published.

**ELN (`main`, `9538f36`):** Handsontable through `sheet/sheetbase-grid.tsx`
and `sheetbase-grid-client.tsx`, used by `canonical-sheet-workspace.tsx` and
`scientific-sheet-block.tsx`, with custom `record-picker-editor.ts` and
`formula-reference-editor.ts`; HyperFormula on the server
(`calculation.server.ts`, `formula-write.server.ts`) and in the grid;
Recharts in `viz/chart-plots.tsx` and `viz/chart-renderer.tsx`. None of the
`sheetbase-components` packages are used.

## COMP-01 — v3 theme contract (components repo)

**Status:** proposed.

### Goal

Every package can be themed to v3 entirely through variables.

### Design

`design/ui-system-v3/design-system/tokens.json`, `README.md`,
`components/SheetGrid/README.md`, `components/Chart/README.md`.

### Scope

- Extend `sheetbase-shared/theme.css` with the variables v3 needs (surface,
  muted, hover, derived surface, grid line, selection and its subtle and border
  variants, link, focus, status marks, status text and washes, series and chart
  axis/grid, fonts, type sizes, control and row heights).
- Replace every literal colour, font and size in `sheetbase-table` and
  `sheetbase-explorer` CSS with variables; add a lint check that fails on new
  literals.
- Ship a `v3` theme preset in `sheetbase-shared` whose values match the design
  tokens exactly, plus a documented way for a host to map the variables onto
  its own tokens (the ELN maps them to its CSS variables).
- Keep the packages' current look available as the default preset so their
  demos keep working.

### Exit

With the v3 preset, no package renders a colour, font or size that is not a v3
token (checked by the lint rule and by COMP-02/03 visual tests).

## COMP-02 — Table to v3 (components repo)

**Status:** proposed.

### Goal

`sheetbase-table` renders every grid state that appears in the design.

### Design

Grids in `canvas/Notebook.dc.html`, `NbEditing`, `NbConflict`, `NbOffline`,
`NbViewer`, `NbSigned`, `SheetWorking`, `SheetPromote`, `DatasetExplorer`,
`ExpDatasets`, `ReviewRecord`, `ImportMap`, `ModelRecords`, `TemplateEditor`;
`design-system/components/SheetGrid/README.md`, `Source/README.md`.

### Scope

- Configurable default row height (28px sheets) and header height; v3 fonts
  and sizes; row numbers; frozen headers.
- Multi-row column headers: a group row naming each source ("Run · this
  experiment", "Measured · DS-0311", "Derived") and per-column `Source`
  badges and ƒx marks.
- Cell states: invalid (danger wash, error mark), flagged, planned/pending,
  read-only dataset column, derived (`surface-derived`), unsynced local edit
  (grey mark, dotted underline), conflict ("2 values"), diff (`del`/`ins`),
  draft row and "New run — type a condition or paste rows" append row.
- Active cell 2px accent outline; selection wash; keyboard model per the
  design (arrows, Enter edits and saves the row, Esc discards, Tab moves right,
  Tab leaves the grid as one tab stop).
- Section presets matching the design: notebook block (no formula bar, no
  toolbar), working sheet, dataset view, record list, read-only viewer.
- Visual tests in the components repo against v3 grid fixtures taken from the
  design screens.

### Exit

Each design grid above can be reproduced by a fixture in the components repo
and matches the corresponding region of the design render.

## COMP-03 — Charts to v3 (components repo)

**Status:** proposed.

### Design

`canvas/Analysis.dc.html`, `AnalysisEmpty`, `ExpResults`, `Notebook`
(Figure 1), `PipelineRun` (step output); `design-system/components/Chart/README.md`.

### Scope

v3 chart rules in `sheetbase-explorer`: `series-a/b/c` with circle, square
and triangle markers; hollow markers for excluded points with a label; dashed,
labelled reference lines; quiet axes and fine gridlines in chart tokens; units
in axis titles; small legends outside the plot; multiple charts with a shared
x axis; the field-role panel ("drag onto an axis") and calculated fields.

### Exit

The design's step-yield and turbidity charts render identically from fixture
data in the components repo.

## COMP-04 — Filter builder to v3 (components repo)

**Status:** proposed.

### Design

Filter builder and chips in `canvas/States.dc.html`; list toolbars in
`canvas/Projects.dc.html`, `ExperimentsList`, `SamplesList`, `DatasetExplorer`;
`design-system/components/ChipTag/README.md`.

### Scope

Restyle `sheetbase-advanced-search` as the v3 filter-builder popover
(field, operator, value rows; add condition; clear; apply) and filter chips
with named remove labels; emit `DatasetQuery` that the ELN list queries accept.

### Exit

The design's filter builder and chip row are reproduced from the package.

## COMP-05 — Releases and consumption

**Status:** proposed; registry per [DEC-12](DEC.md).

### Scope

- Publish the packages to a private registry (GitHub Packages under
  `sheetbase-labs`, or a private npm scope) using the existing lockstep
  release flow and pack smoke test.
- The ELN depends on exact versions; upgrades are ordinary PRs that run the
  ELN's visual parity suite.
- A documented local-development path to test unreleased package changes in
  the ELN (pnpm `link:`/overrides), never committed.

### Exit

The ELN installs the packages from the registry in CI with a frozen lockfile,
and a package release that changes a v3 screen fails the ELN parity suite.

## COMP-06 — Replace Handsontable

**Status:** proposed; after [DEC-02](DEC.md) accepts [ADR-0048](../../decisions/0048-sheet-grid-on-sheetbase-table.md).

### Scope

- Reimplement `sheet/sheetbase-grid*.tsx` on `sheetbase-table`, keeping the
  existing write path: bound cells write through the canonical sheet RPCs with
  expected revisions; local and calculated columns keep their owners
  (ADR-0020/0022).
- Record-link editor, formula reference editing and function autocomplete on
  the table's editor hooks.
- Implement the formula-authority decision from ADR-0048 so the grid and the
  server never disagree on a value.
- Remove `handsontable`, `@handsontable/react-wrapper`,
  `VITE_HANDSONTABLE_LICENSE_KEY` and the `--ht-*` theme.

### Exit

All sheet surfaces (canonical, composed, ad-hoc, notebook blocks) run on
`sheetbase-table`; existing grid, write-back and formula tests pass unchanged
in intent; Handsontable is gone from the dependency tree.

## COMP-07 — Replace Recharts

**Status:** proposed.

### Scope

Render chart blocks and analysis figures (`viz/chart-plots.tsx`,
`viz/chart-renderer.tsx`) with `sheetbase-explorer` from the existing chart
specification (ADR-0029); keep exported figures (PNG/SVG in reports and signed
PDFs) identical to what is shown; remove `recharts`.

### Exit

Every chart in the ELN is rendered by the package; signed records that cite a
figure still render it from the cited analysis version.
