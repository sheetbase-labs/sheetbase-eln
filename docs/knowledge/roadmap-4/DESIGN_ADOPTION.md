---
title: Roadmap 4 — adopting UI system v3
status: proposed
last_reviewed: 2026-09-27
---

# Adopting UI system v3 and replacing the current interface

This is the strategy for getting the Sheetbase UI system v3 design into the
repository and making it the product's only interface. The decision it relies
on is recorded as proposed [ADR-0047](../decisions/0047-ui-system-v3-adoption.md).
The design itself is vendored at
[`../design/ui-system-v3/`](../design/ui-system-v3/README.md).

## The bar: exactly v3, fully working

- **Looks exactly like v3.** Every screen matches its design screen in layout,
  spacing, type, colour, icons, copy and states, in light and dark, at the
  design's frame sizes. This is enforced by automated visual comparison against
  renders of the design itself (see [Verification](#verification)).
- **Works exactly like v3.** Every control, flow and state a screen shows is
  real. A screen is not done while any of its controls is missing or inert.
  The capabilities behind them are part of Roadmap 4, including those that
  need a decision first; those decisions are tasks inside the roadmap.
- **Same data as v3.** The design's scenario (Process Development workspace,
  AAV9 process transfer, EXP-0142, DS-0311, SMP-2231 and every other record on
  the screens) is seeded exactly, so the app and the design are compared on
  identical content.
- **The design leads.** A change to how the product should look or behave is
  made in the design first, re-vendored, and then implemented.

## Recommendation in one paragraph

Re-implement the design on the stack we already have (React 19, TanStack
Router, Tailwind v4, shadcn/Radix primitives) and move the data-heavy surfaces
onto our own `sheetbase-components` packages: `sheetbase-table` replaces
Handsontable, `sheetbase-explorer` powers analysis charts, and
`sheetbase-advanced-search` powers the filter builder. Those packages are
restyled to v3 in their own repository; changing them is in scope. Do not import
the design canvas's code. Land the work in layers on `main`, each leaving the
app working: **tokens**, then **primitives restyled in place**, then **the
component packages themed and integrated**, then **the new shell**, then
**screens rebuilt route by route on real data** with their capabilities,
deleting what they replace. Keep no parallel "old UI" behind a flag.

## What the design is, technically

- **126 screens** as `.dc.html` files: static markup with hard-coded sample data
  and a small interaction script (menus, tabs, toasts). They describe layout,
  copy, states and flows, not data access.
- **A design system**: `tokens.json` (50 colour tokens in light and dark, type,
  spacing, radius, shadow and layout sizes), a brand book, 27 component
  guidelines, and `bundle.js`/`bundle.css` implementing 26 components as
  `window.Sheetbase.*` for the canvas.

## Options considered

| Option                                                                  | Verdict                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A. Ship `bundle.js`/`bundle.css` and mount its components**           | Rejected. It is an untyped global that reads `window.React`, styles through class strings and inline `sx` strings, injects SVG with `dangerouslySetInnerHTML`, and syncs theme through `postMessage` across frames. It would bypass the Radix focus management, the typed component contracts, `src/lib/contrast.ts` evidence and the Storybook gate we already have. |
| **B. Convert the `.dc.html` screens into route components**             | Rejected. Every value on every screen is literal sample data. A conversion yields markup that must then be rewired to queries field by field, which is the same work as building the screen, plus a large cleanup of hard-coded content.                                                                                                                              |
| **C. Keep the current UI and restyle it toward the design**             | Insufficient. Tokens and primitives get close, but the design changes information architecture (Home/Inbox/Schedule, Experiments, Protocols, Materials, Models), page anatomy (page header, tabs, inspector) and flows. Restyling alone leaves the old structure.                                                                                                     |
| **D. Re-implement on the existing stack, layer by layer (recommended)** | Tokens and primitives change globally, so every existing screen moves toward the design immediately. The shell and screens are then rebuilt against real queries, reusing the data layer (`src/lib/*`) that already backs most of what the design shows.                                                                                                              |

## The layers

### 1. Tokens — [DSYS-02](tasks/DSYS.md)

`design-system/tokens.json` becomes the source for `src/styles.css`. Values
are converted to OKLCH (ADR-0007 keeps OKLCH as the format) and fed through the
existing contrast test. Most existing semantic names map directly, so every
shadcn component picks up the new palette with no component changes.

| Design token                                                                    | Implementation                                                                                                                                        |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bg`                                                                            | `--background`                                                                                                                                        |
| `surface`                                                                       | `--card`, `--popover`                                                                                                                                 |
| `text`, `text-muted`, `text-faint`                                              | `--foreground`, `--muted-foreground`, new `--faint-foreground`                                                                                        |
| `surface-muted`                                                                 | `--muted`, `--secondary`                                                                                                                              |
| `surface-hover`                                                                 | `--accent` (shadcn uses `accent` for hover and highlighted menu items)                                                                                |
| `selection`, `selection-subtle`, `selection-border`                             | new `--selection*`; `--sidebar-accent` = `selection`                                                                                                  |
| `accent-strong`, `on-accent`                                                    | `--primary`, `--primary-foreground`                                                                                                                   |
| `accent`, `accent-hover`                                                        | new `--link`, `--link-hover`                                                                                                                          |
| `focus`                                                                         | `--ring`                                                                                                                                              |
| `border`, `border-subtle`, `border-strong`, `grid-line`                         | `--border`, `--input`, new `--border-subtle`, `--border-strong`, `--grid-line`                                                                        |
| `danger`, `danger-text`, `danger-wash`, `danger-border`                         | `--destructive` plus new `--danger-text`, `--danger-wash`, `--danger-border`                                                                          |
| `success*`, `warning*`                                                          | existing `--success`, `--warning` plus new `-text`, `-wash`, `-border` tokens                                                                         |
| `review`, `review-wash`, `analysis`, `neutral-dot`                              | `--violet` renamed to `--review`; new `--review-wash`, `--analysis`, `--neutral-dot`                                                                  |
| `series-a/b/c`, `chart-grid`, `chart-axis`                                      | `--chart-1..3` (ordered as the design), new `--chart-grid`, `--chart-axis`                                                                            |
| `surface-derived`, `row-hover`, `skeleton`, `highlight`, `canvas-sunken`        | new tokens of the same names                                                                                                                          |
| `inverse-bg`, `inverse-text`, `scrim`, `hatch`                                  | new tokens of the same names                                                                                                                          |
| `radius-sm/md/lg`                                                               | `--radius` = 6px; `rounded-sm` 4px; dialogs only use 10px                                                                                             |
| `shadow-overlay`, `shadow-dialog`                                               | `--shadow-overlay`, `--shadow-dialog`; no other shadows                                                                                               |
| `font-heading/sans/mono`                                                        | `--font-display`, `--font-sans`, `--font-mono` = JetBrains Mono (add `@fontsource-variable/jetbrains-mono`)                                           |
| type styles `page-title` … `id`                                                 | Tailwind `@utility` classes `text-page-title`, `text-section`, `text-doc-heading`, `text-prose`, `text-body`, `text-label`, `text-caption`, `text-id` |
| `topbar-height`, `nav-width`, `inspector-width`, `row-height`, `control-height` | `--topbar-height` 44px, `--nav-width` 232px, `--inspector-width` 300px, `--row-height` 32px, `--control-height` 28px                                  |

Dark mode stays a parallel token set selected by the `.dark` class that
`ThemeProvider` already manages; the design's `data-theme` attribute is not
adopted. The design fixes interface text at 13px, so the two density modes
from ADR-0007 collapse into the design's single density (ADR-0047).

### 2. Primitives restyled in place — [DSYS-03](tasks/DSYS.md), [DSYS-04](tasks/DSYS.md)

Keep the component files and their call sites; change what they render.

| Design component                                                                                | Where it goes                                                                                                                                      |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button` (primary, secondary, quiet, danger, danger-fill; sm 24px, md 28px, lg 44px; icon-only) | `src/components/ui/button.tsx` variants and sizes, mapped from the current names                                                                   |
| `Menu`, `MenuItem`, `MenuSep`, `MenuLabel`                                                      | `ui/dropdown-menu.tsx`, `ui/context-menu.tsx`                                                                                                      |
| `Tooltip`                                                                                       | `ui/tooltip.tsx` (inverse colours, never holds actions)                                                                                            |
| `Toast`                                                                                         | `ui/sonner.tsx` theme: bottom centre, 6 s, one at a time, Undo only when reversible                                                                |
| `Banner`, `Notice`                                                                              | `ui/alert.tsx` split into page-level `Banner` and local `Notice`                                                                                   |
| `EmptyState`, `Skeleton`, `Kbd`, `Avatar`                                                       | `ui/empty.tsx`, `ui/skeleton.tsx`, `ui/kbd.tsx`, `ui/avatar.tsx`                                                                                   |
| `Segmented`                                                                                     | `ui/toggle-group.tsx` variant                                                                                                                      |
| `Status`, `Dot`                                                                                 | `scientific/status-badge.tsx`, rebased on the nine design tones                                                                                    |
| Tabs, fields, inputs, selects, dialogs                                                          | `ui/tabs.tsx` (36px, 2px underline), `ui/field.tsx`, `ui/input.tsx`, `ui/select.tsx`, `ui/dialog.tsx`                                              |
| `.t` record table                                                                               | `scientific/data-table.tsx` (31px header, 32–33px rows, numbers right-aligned, `tr.sel`)                                                           |
| `.g` sheet grid                                                                                 | `sheetbase-table` with the v3 theme (COMP-01..04): 28px rows, `grid-line`, `surface-derived` for ƒx, 2px active-cell outline, source group headers |
| `.dl` description list                                                                          | `scientific/property-list.tsx`                                                                                                                     |
| `Icon` (49 names)                                                                               | New `src/components/icons/` with the design's exact 16px, 1.4px-stroke paths, typed by name. Lucide stays only where the design has no icon.       |
| New: `Source`, `Diff`, `Tag`, `Chip`, `Choice`, `Stepper`, `Tree`/`TreeItem`, `Secret`          | New files in `src/components/ui/` (generic) or `src/components/scientific/` (Source, Diff) with stories                                            |

Each component gets a Storybook story; `/foundations` shows tokens, type and
contrast from the same sources, as today.

### 3. Component packages — [COMP-01..07](tasks/COMP.md)

`sheetbase-components` is ours, so it is changed to fit v3 rather than wrapped
or overridden from the outside.

| Package                                           | Used for in v3                                                                                                                | Work                                                                                                                                                                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sheetbase-shared`                                | Theme contract for every package                                                                                              | Add a v3 theme whose variables resolve to the ELN tokens; add missing variables (washes, status text, derived surface, grid line)                                                                                                       |
| `sheetbase-table`                                 | Every grid: notebook sheet blocks, working sheets, dataset data tab, model record lists, import mapping preview, review diffs | Replace ~500 literal colours with theme variables; configurable row height (28px), fonts and density; column group headers with `Source`; validation, flagged, pending, unsynced, conflict and diff cell states; v3 selection and focus |
| `sheetbase-explorer`                              | Analysis workspace charts, notebook figures, pipeline run figures                                                             | v3 chart rules: series colours with circle/square/triangle markers, hollow excluded points, labelled reference lines, quiet axes; field-role drag panel as in `Analysis.dc.html`                                                        |
| `sheetbase-advanced-search`                       | Filter builder popover and list filter chips                                                                                  | Restyle to v3 menus and chips; compile to the ELN's list queries                                                                                                                                                                        |
| `sheetbase-schemaeditor`, `sheetbase-rulesengine` | Not on any v3 screen                                                                                                          | Not adopted by Roadmap 4                                                                                                                                                                                                                |

The ELN consumes the packages as versioned releases (COMP-05): the release
flow in `sheetbase-components/docs/publishing.md` already exists; the packages
go to a private registry rather than public npm. Handsontable, its React
wrapper and `VITE_HANDSONTABLE_LICENSE_KEY` are removed when the last grid moves.

Formula authority needs a decision before the grid swap (proposed
[ADR-0048](../decisions/0048-sheet-grid-on-sheetbase-table.md)): today
HyperFormula evaluates formulas on the server (`calculation.server.ts`,
ADR-0021/0022) and in the Handsontable grid. `sheetbase-table` has its own
engine, so either the server moves to the same engine or the grid displays
server results and uses its engine only for preview while editing.

### 4. The shell — [SHELL-01..05](tasks/SHELL.md)

Replace `src/components/app-shell.tsx` (1,425 lines) with the design's anatomy:
44px top bar (brand, workspace switcher, ⌘K search, New menu, notifications,
account menu with appearance), 232px navigation collapsing to a 48px rail,
page header with breadcrumbs, title, status line and actions, tabs, content,
and a 300px inspector slot. Every route gets the new frame at once; old page
bodies render inside it until their screen is rebuilt.

### 5. Screens and capabilities, route by route — every other stream

Each screen is rebuilt against its existing query layer, together with the
capability tasks it depends on; the screen and its capabilities ship together. The route map below
says which route each design screen becomes. When a route lands, its old
components are deleted in the same PR; nothing is kept for compatibility
(pre-release delivery rule in [`../ROADMAP.md`](../ROADMAP.md)).

## Route map

| Design screens                                                                                                               | Route (new unless noted)                                                                                           | Replaces                                        |
| ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| Main, HomeFirstRun                                                                                                           | `/`                                                                                                                | `/` dashboard                                   |
| HomeTriage, InboxEmpty                                                                                                       | `/inbox`                                                                                                           | `/reviews` list, Liveblocks inbox page          |
| HomeBench, ScheduleEmpty                                                                                                     | `/schedule`                                                                                                        | `/calendar`                                     |
| Projects, ProjectsEmpty/Error/NoResults                                                                                      | `/projects`                                                                                                        | `/projects`                                     |
| ProjectDetail, ProjectFolders, FolderMove, ProjectFiles, ProjectMembers, ProjectSettings, ProjectLVV, ProjectAmbr            | `/projects/$projectId/{overview,folders,experiments,samples,datasets,files,members,settings}`                      | `/projects/$projectId`                          |
| ExperimentsList, ExperimentsLoading                                                                                          | `/experiments`                                                                                                     | —                                               |
| NewExperiment                                                                                                                | `/experiments/new`                                                                                                 | create-blank-experiment dialog                  |
| ExpOverview, Notebook, ExpSamples, ExpDatasets, ExpResults, ExpFiles, ExpHistory, Nb\*                                       | `/records/$recordId/{overview,notebook,samples,datasets,results,files,history}`                                    | `/records/$recordId`, `/overview`               |
| ReviewRecord, ReviewSign, ReviewReturned, ReviewApproved                                                                     | review mode of `/records/$recordId/notebook`                                                                       | `/reviews/$revisionId`                          |
| EvidenceCompare, EvidencePhone                                                                                               | `/records/$recordId/evidence/$revisionId`                                                                          | —                                               |
| SamplesList, SamplesEmpty                                                                                                    | `/samples`                                                                                                         | `/samples`                                      |
| SampleDetail, SampleLineage, SampleUsage, SampleMeasurements, SampleHistory, SampleQuarantine, SampleExpired, SampleConsumed | `/samples/$sampleId/{details,lineage,usage,measurements,history}`                                                  | `/samples?selected=`, `/lineage`                |
| MaterialsList                                                                                                                | `/materials`, `/materials/$materialId`                                                                             | `/reagents`                                     |
| ProtocolsList, ProtocolDetail                                                                                                | `/protocols`, `/protocols/$protocolId`                                                                             | `/templates?protocol=`                          |
| TemplatesList, TemplateEditor, TemplateUpdate                                                                                | `/templates`, `/templates/$templateId`, `/records/$recordId/template-update`                                       | `/templates`                                    |
| DatasetsList, DatasetsError, DatasetExplorer, DatasetSnapshots, DatasetCompare, SnapshotRemoved, SnapshotsLaptop             | `/datasets`, `/datasets/$datasetId/{data,columns,imports,snapshots,compare,history}`                               | `/datasets?dataset=`                            |
| ImportUpload, ImportMap, ImportFailed                                                                                        | `/import`                                                                                                          | import wizard dialog                            |
| RecordInstrument                                                                                                             | `/instruments/$instrumentId`                                                                                       | `/instrument-monitor` (decision SHELL-04)       |
| SheetWorking, SheetEmpty, SheetPromote, PromoteRejected, SheetTablet                                                         | `/sheets/$instanceId`                                                                                              | `/sheets/$instanceId`                           |
| Analysis, AnalysisEmpty                                                                                                      | `/analysis`, `/analysis/$analysisId`                                                                               | `/analysis`                                     |
| SearchPalette, SearchEmpty                                                                                                   | ⌘K palette in the shell                                                                                            | —                                               |
| SearchResults                                                                                                                | `/search`                                                                                                          | `/search`                                       |
| SchemasList, SchemaEditor, SchemaPending, ModelRecords, ModelFields, ModelVersions, RecordDetail, RecordNew                  | `/models`, `/models/$modelId/{fields,rules,relations,versions,usage,records}`, `/models/$modelId/records/new`      | `/configure`                                    |
| PipelinesList, PipelineEditor, PipelineTriggers, PipelineRuns, PipelineRun, PipelineRunWaiting, PipelineRunFailed            | `/pipelines`, `/pipelines/$definitionId/*`, `/pipelines/runs/$runId`                                               | same routes                                     |
| Settings\*, IntegrationConnect, IntegrationDeliveries, TokenCreate, TokenExpired, AuditLog                                   | `/settings/{general,members,access,signatures,instruments,integrations,api,audit,profile,signature,notifications}` | `/admin/$section`, `/settings`, `/integrations` |
| ClientPortal                                                                                                                 | `/portal` (separate shell)                                                                                         | —                                               |
| Phone\*, RecordPhone                                                                                                         | same routes, phone layout below 600px; `/scan`                                                                     | —                                               |
| NotebookLaptop, NotebookTablet, ProjectsTablet                                                                               | responsive behaviour of their routes                                                                               | —                                               |
| SignedOut                                                                                                                    | `/sign-in` signed-out state                                                                                        | `/sign-in`                                      |
| States, FocusOrder, Shortcuts, Panels, DialogsCreate, DialogsRecord                                                          | Component and interaction specs, not routes                                                                        | —                                               |

**Routes with no design screen:** `/agent-operations`, `/plate-designer`,
`/planner`, `/instrument-monitor`, `/storage`, `/report-builder`, `/lineage`,
`/docs/$name`. Their fate is decided in [SHELL-04](tasks/SHELL.md) before the
shell lands; until then they render in the new frame unchanged.

## Verification

- **Reference renders of the design.** `pnpm design:render` renders all 126
  design screens, light and dark, from the vendored snapshot using the vendored
  canvas runtime and local fonts, into `tests/visual/design-reference/`
  (generated, not committed). Renders are deterministic: repeated runs are
  byte-identical.
- **Design-data seed** ([DSYS-05](tasks/DSYS.md)). `pnpm db:seed:design`
  creates every record, value, person, time and relationship that appears on
  the screens, through canonical RPCs, with a fixed clock (Friday 25 September
  2026, Europe/London) so relative times match.
- **Visual parity tests** ([DSYS-06](tasks/DSYS.md)). A Playwright project
  opens each route in the state its design screen shows, at the same frame size
  and theme, and compares it with the reference render using
  `toHaveScreenshot`, with the render as the expected image. The tolerance is
  small and fixed (anti-aliasing only); a failing comparison fails CI. Screens
  showing a menu, dialog or other state are driven into that state first.
- **Behaviour.** Each screen PR also covers the interactions its design screen
  scripts (menus, tabs, toasts, dialogs, keyboard) with browser tests.
- **No exceptions list.** A screen with a visual difference is not done. If the
  design is wrong or impossible, the design is changed and re-vendored first.
- **Existing gates stay.** Contrast tests, component tests, Storybook and the
  `/foundations` review page remain the authority for tokens and primitives.

## Sequencing and size

```text
DSYS-01 snapshot + renders (done) ─▶ DSYS-02 tokens ─▶ DSYS-03/04 primitives ─▶ SHELL-01..03
                                          │                    │
                           COMP-01..04 packages themed ────────┤
                                                               │
                        DSYS-05 design seed + DSYS-06 parity ──┤
                                                               ▼
     screen + capability streams in parallel (WORK, PROJ, EXP, DSET, LAB, SHEET, MDL, PIPE, SRCH, SET, MOB, REV, PORTAL)
     decision tasks (ADRs) are scheduled early in each stream so they never hold a screen back
```

Tokens and primitives are about a week of focused work and change the whole
app's look at once. The shell is a single larger PR. Screen work is the bulk:
roughly 60 routes and states, each shipped with the capabilities it shows.
Roadmap 4 is complete only when every design screen passes visual parity on
the design seed and every control on it works.

## Things this strategy deliberately does not do

- It does not keep the old UI reachable behind a flag or a `/legacy` prefix.
- It does not skip the decision a new concept needs. Where a screen implies a
  new concept (client users, workspace-defined models, controlled protocols,
  password signing), the owning stream starts with a task that writes and
  decides the ADR; the capability is then built, not deferred.
- It does not wrap or override `sheetbase-components` from the ELN side; the
  packages are changed at source.
