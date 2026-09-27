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

## Working in two repositories

`sheetbase-components` uses Bun, Vitest, Biome and Playwright; read its
`AGENTS.md` first. Clone it next to this repository, run `bun install`, then
`bun run typecheck && bun run lint && bun run test` before and after every
change. COMP-01..04 are PRs there; COMP-05..07 are PRs here. Recipe 5.10 in
[`../GUIDE.md`](../GUIDE.md) covers trying an unreleased package in the ELN.

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

### Start here (components repo)

- `packages/shared/src/theme.css`: 49 variables under `.sheetbase-scope` and
  `.sheetbase-explorer`, light and `[data-theme="dark"]`.
- Literal colours to remove: `packages/table/src/ui/styles/base.css` (133),
  `chrome.css` (111), `overlays.css` (109), `grid.css` (96), `extras.css` (51),
  about 50 more in `packages/table/src/**/*.tsx`, and 19 in
  `packages/explorer/src/*.css`. Find them with
  `grep -rnoE "#[0-9a-fA-F]{3,8}\b|rgba?\(" packages/table/src packages/explorer/src`.
- Hard-coded sizes: `packages/table/src/ui/Spreadsheet.tsx` (`ROW_HEIGHT = 31`,
  `COLUMN_HEADER_HEIGHT = 31`, `ROW_HEADER_WIDTH = 50`), font sizes in the CSS
  (`--text-size: 12px`, `--meta-size: 11px`).
- `biome.json` (lint baseline).

### Steps (PRs)

1. Extend `theme.css` with the full variable set (names from the v3 token list:
   surface, surface-muted, surface-hover, surface-derived, grid-line, border,
   border-subtle, border-strong, text, text-muted, text-faint, link, focus,
   selection, selection-subtle, selection-border, status marks, status text,
   washes, series-a..c, chart-grid, chart-axis, font families, text sizes,
   row/header/control heights). Keep today's values as the default preset.
2. Replace literals in the table CSS, one file per commit, then the TSX
   literals; replace them in explorer CSS.
3. Add `packages/shared/src/themes/v3.css` whose values equal
   `tokens.json` exactly, and document host mapping in `packages/shared/README.md`
   (a host may set each variable to `var(--its-own-token)`).
4. Add a lint check (a small script run by `bun run lint`) failing on colour
   literals in package CSS/TSX outside `themes/`.

### Check it

`bun run lint && bun run test && bun run test:e2e` (table); the demos look
unchanged with the default preset; switching the demo to `v3.css` changes
every surface.

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

### Start here (components repo)

- `packages/table/src/ui/Spreadsheet.tsx` (props at `SpreadsheetProps`,
  `DatasetHeaderConfig`, `initialAnnotations`, `onWriteStateChange`,
  `readOnly`, `computedColumns`), `GridCell.tsx`, `DataGrid.tsx`,
  `TableSections.tsx` (`TableSectionConfig`, `minimalTableSections`,
  `TableLayout`), `SheetbaseTable.tsx`, `TableSurface.tsx`.
- Styles in `packages/table/src/ui/styles/`.
- End-to-end tests in `packages/table/e2e/specs/`.
- Design grids: render `Notebook`, `NbEditing`, `NbConflict`, `NbOffline`,
  `NbViewer`, `SheetWorking`, `DatasetExplorer`, `ReviewRecord`, `ImportMap`.

### Steps (PRs)

1. Props `defaultRowHeight`, `headerHeight`, `rowHeaderWidth` replacing the
   constants (defaults unchanged); v3 preset uses 28px rows.
2. Header groups: extend `DatasetHeaderConfig` with ordered groups
   (`{ label, fromColumn, toColumn }`) rendered as an extra header row, and a
   per-column `source` (`dataset | record | calc | local`) with an optional
   label (for example "DS-0311 · S-15") rendered as the v3 `Source` badge.
3. Cell states: a `cellState(row, column)` callback returning one of
   `invalid | flagged | pending | derived | readonly | unsynced | conflict | diff`
   plus data for `diff` (`before`, `after`) and `conflict` (count). Style each
   from the theme variables. Unit tests per state.
4. Append row ("New run — type a condition or paste rows") and draft-row
   state via `onRecordCreate`, and a notebook section preset
   (`notebookTableSections`: no menu bar, toolbar or formula bar).
5. Keyboard model per `design-system/components/SheetGrid/README.md` and
   `canvas/FocusOrder.dc.html`: the grid is one tab stop; Tab moves right
   inside, leaves at the last column.
6. Visual fixtures: `packages/table/e2e/specs/v3-grids.spec.ts` rendering each
   design grid from fixture data with `v3.css`, compared with crops of the ELN
   renders (copy the PNG crops into the components repo under
   `e2e/fixtures/v3/`, noting the source screen).

### Check it

`bun run test && bun run test:e2e`; each fixture screenshot matches its crop.

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

### Start here (components repo)

- `packages/explorer/src/lib/chart.ts` (`buildChart`), `lib/export.ts`
  (`exportChartPng`, `serializeChartSvg`), `App.tsx` and `explorer-*.css`.
  Charts use `@tanstack/charts`; icons use `@hugeicons/react`.

### Steps (PRs)

1. Export a standalone `Chart` component (spec in, SVG out) that does not need
   the explorer `App`, so the ELN can render notebook figures.
2. Series styles from theme variables with marker shapes by series index
   (circle, square, triangle); `excluded` points drawn hollow with a label;
   reference lines (value, unit, label, dashed); axis titles with units.
3. Multiple charts sharing an x axis (the Analysis screen shows two).
4. Field-role panel matching `Analysis.dc.html` (drag fields onto x, y, y2,
   series; calculated field).
5. Replace Hugeicons with the v3 icon set (export the icon paths from
   `sheetbase-shared` so both repos use one source).

### Check it

Fixture tests rendering the step-yield and turbidity charts from the design's
numbers, compared with crops of the `Analysis` and `Notebook` renders.

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

### Start here (components repo)

`packages/advanced-search/src/AdvancedSearch.tsx`, `predicate.ts`, `types.ts`,
`styles.css`; `packages/shared` (`FilterNode`, `DatasetQuery`,
`compileToDatasetQuery`).

### Steps (PRs)

1. A `FilterBuilder` popover export (rows of field / operator / value, add
   condition, clear, apply) styled with theme variables; the existing
   full-page `AdvancedSearch` stays for the demo.
2. A `FilterChips` export (one chip per condition, named remove label,
   "+ Add filter").
3. Fixture test against the filter builder in `canvas/States.dc.html`.

### Check it

`bun run test`; fixture screenshot matches the States render crop.

### Exit

The design's filter builder and chip row are reproduced from the package.

## COMP-05 — Releases and consumption

**Status:** proposed; [DEC-12](DEC.md) decided 2026-09-27 — private, no public publish.

### Scope

- Keep the packages private; do not publish them to public npm. Until a private
  registry is needed, consume them in the ELN through a local `link:`/workspace
  override (never committed). When a registry is needed, use GitHub Packages
  scoped to `sheetbase-labs`, using the existing lockstep release flow and pack
  smoke test.
- The ELN depends on exact versions; upgrades are ordinary PRs that run the
  ELN's visual parity suite.
- A documented local-development path to test unreleased package changes in
  the ELN (pnpm `link:`/overrides), never committed.

### Start here

`sheetbase-components/docs/publishing.md` (lockstep versions, `pack:smoke`,
`.github/workflows/release.yml`), `scripts/version.mjs` and `scripts/pack-smoke.mjs` in that repo; in the
ELN, `package.json` and `pnpm-workspace.yaml`.

### Steps (PRs)

1. Components repo: when a private registry is needed, point `publishConfig` at
   GitHub Packages, add the registry token secret and release in lockstep.
   Until then, keep the public `bun publish --access public` flow unused.
2. ELN: consume the packages privately. Add `.npmrc` registry scope only when
   the registry exists (no token committed; CI reads it from a secret), then add
   `sheetbase-shared`, `sheetbase-table`, `sheetbase-explorer`,
   `sheetbase-advanced-search` at exact versions and import `v3.css` from
   `src/styles.css` mapped onto the ELN variables. Before then, a local
   `link:`/override.
3. Document the upgrade flow in `docs/development/sheetbase-components.md`.

### Check it

`pnpm install --frozen-lockfile` in CI; a demo route rendering a package grid
with ELN tokens.

### Exit

The ELN installs the packages from the registry in CI with a frozen lockfile,
and a package release that changes a v3 screen fails the ELN parity suite.

## COMP-06 — Replace Handsontable

**Status:** proposed; [DEC-02](DEC.md) accepted [ADR-0048](../../decisions/0048-sheet-grid-on-sheetbase-table.md) option (b) on 2026-09-27 — the server adopts the `sheetbase-table` engine and HyperFormula/Handsontable are removed.

### Scope

- Reimplement `sheet/sheetbase-grid*.tsx` on `sheetbase-table`, keeping the
  existing write path: bound cells write through the canonical sheet RPCs with
  expected revisions; local and calculated columns keep their owners
  (ADR-0020/0022).
- Record-link editor, formula reference editing and function autocomplete on
  the table's editor hooks.
- Implement the formula-authority decision from ADR-0048 option (b): the
  server evaluates with the `sheetbase-table` engine, so the grid and the
  server never disagree. This needs the engine parity work in
  `sheetbase-components` recorded in ADR-0048: the 18 missing statistical
  functions, the boolean/date/error/format/spill semantics and the compiled
  `SUBSTITUTE`/`FILTER` path.
- Remove `handsontable`, `@handsontable/react-wrapper`,
  `VITE_HANDSONTABLE_LICENSE_KEY` and the `--ht-*` theme.

### Start here

- `src/components/sheet/sheetbase-grid.tsx` (`SheetbaseGrid`,
  `SheetbaseGridSettings`, which exposes Handsontable settings to callers) and
  `sheetbase-grid-client.tsx`; `docs/development/handsontable.md`.
- Callers: `canonical-sheet-workspace.tsx` (1,914 lines) and
  `scientific-sheet-block.tsx` (2,281 lines); editors
  `record-picker-editor.ts`, `formula-reference-editor.ts`,
  `function-autocomplete*.ts(x)`.
- Formula paths: `src/lib/calculation.server.ts`, `formula-write.server.ts`,
  `hyperformula-profile.ts`, `formula-ir.ts`, `scientific-workbook.ts`.
- Tests to keep green: `sheetbase-grid-client.test.tsx`,
  `canonical-sheet-workspace.test.tsx`, `ad-hoc-sheet-workspace.test.tsx`,
  `formula-reference-editor.test.ts`, `tests/browser/grid-keyboard-selection.test.ts`,
  `pnpm test:phase4`.

### Steps (PRs)

1. Vendor-neutral wrapper: redefine `SheetbaseGridProps` in Sheetbase terms
   (columns with source and type, rows, cell state, write callbacks) and adapt
   both callers to it while still rendering Handsontable underneath. No visual
   change; all tests pass.
2. Implement the wrapper on `sheetbase-table` behind the same props; switch
   the ad-hoc sheet first, then canonical sheets, then notebook sheet blocks,
   one PR each.
3. Editors: record link and formula reference editing on the table's editor
   hooks; function autocomplete from the same function list.
4. Formula authority per ADR-0048 option (b). In `sheetbase-components`:
   implement the 18 missing statistical functions, fix the compiled
   `SUBSTITUTE`/`FILTER` path and align boolean/date/error/format/spill
   semantics with a parity suite over the ADR corpus. In the ELN: move
   `calculation.server.ts`/`formula-write.server.ts` and the profile onto the
   table engine and remove HyperFormula, keeping ADR-0021/0022 contracts.
5. Remove Handsontable packages, `VITE_HANDSONTABLE_LICENSE_KEY` (from
   `.env.example`, `src/env.server.ts`/client env, compose files, docs), the
   `--ht-*` CSS and `docs/development/handsontable.md` (replace with a
   `sheetbase-table` integration doc).

### Check it

All listed tests plus `pnpm test:phase4` pass after each PR;
`grep -rn handsontable src package.json` is empty at the end.

### Exit

All sheet surfaces (canonical, composed, ad-hoc, notebook blocks) run on
`sheetbase-table`; existing grid, write-back and formula tests pass unchanged
in intent; the ADR-0048 parity suite passes and HyperFormula is gone;
Handsontable is gone from the dependency tree.

## COMP-07 — Replace Recharts

**Status:** proposed.

### Scope

Render chart blocks and analysis figures (`viz/chart-plots.tsx`,
`viz/chart-renderer.tsx`) with `sheetbase-explorer` from the existing chart
specification (ADR-0029); keep exported figures (PNG/SVG in reports and signed
PDFs) identical to what is shown; remove `recharts`.

### Start here

`src/components/viz/chart-plots.tsx`, `chart-renderer.tsx`, `chart-frame.tsx`,
`analysis-panel.tsx`; chart spec in `src/lib/chart-spec.ts` and
`src/lib/chart-data.ts` (ADR-0029); report/PDF figure export in
`src/lib/report-builder.ts`.

### Steps (PRs)

1. Map `chart-spec.ts` to the package `Chart` props (series, markers,
   excluded points, reference lines, axes); unit tests per chart type.
2. Replace the Recharts renderer; keep `chart-frame.tsx` as the container.
3. Figure export (PNG/SVG) through the package export functions; check a
   signed record's figure still renders from its cited analysis version.
4. Remove `recharts`.

### Check it

`pnpm test src/components/viz src/lib/chart-*`, `tests/browser/sci-04-visualisation.test.ts`,
`grep -rn recharts src package.json` empty.

### Exit

Every chart in the ELN is rendered by the package; signed records that cite a
figure still render it from the cited analysis version.
