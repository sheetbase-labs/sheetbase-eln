---
title: ReUI and in-house componentisation opportunity scan — v3 surfaces
status: proposal — scan only, no implementation
last_reviewed: 2026-10-16
---

# ReUI and in-house componentisation opportunity scan — v3 surfaces

A discovery pass over the v3 surfaces, looking for **new** generic UI jobs the app
hand-rolls — beyond the ones already planned (Sortable, Data Grid, Frame, File
Upload, Timeline, Stepper, Empty, Event Calendar, Date/Time pickers, Combobox
family, Tree, Number Field, Signature Pad, Icon Tile/Marker/Trace/Kbd). It ranks
candidates by _worth doing and what it buys_ rather than by the plan's old tier
gate, states where the bar in
[`ADR-0055`](../decisions/0055-component-primitives-and-reui-registry.md) and
`plans/notebook-editor-and-reui.html` §4.4 is **not** cleared, and adds a second
list the tiers had no room for: jobs with several hand-rolled versions for which
ReUI has no item at all.

Nothing here is implemented, and nothing here authorises work. A ReUI adoption
still needs a row in
[`component-comparison-record.md`](component-comparison-record.md) — the harness
exists (`src/components/component-compare/`) and has one row.

## Scope, base and method

- **Base:** branch `scan/v3-opportunities` from `origin/GWP/notebook-document-surface`
  at `35423ec`. All counts and line numbers are from that revision.
- **Scanned:** `src/components/v3/**` — 186 TypeScript files (37,612 lines), of
  which 26,156 lines outside tests and stories — plus the route screens that
  compose the v3 kit, because in this tree the v3 screen body lives in a route
  for some areas (143 routes import `#/components/v3`). Where a finding sits in a
  route screen it says so.
- **Method:** source reading only. No browser, no render, no axe, no execution.
  Counts are exact occurrences of the cited pattern at this revision; line counts
  drift.
- **What the kit already owns** (`src/components/v3/ui/`, 27 primitives): alert
  (`Notice` + `Banner`), avatar, badge (`Tag`), button, checkbox, choice, command,
  confirm-dialog, dialog, dropdown-menu, empty-state, filter-menu, input (+
  `Field`), kbd, layout (`PageHeader`, `Inspector`, `Section`, `DescriptionList`,
  `Muted`), popover, radio-group, secret, sheet (+ sheet-grid), skeleton, sonner,
  source, status, stepper, table, tabs, tooltip, tree.
- **Nothing in the v3 surfaces imports the legacy kit.** Repo-wide, the only
  non-story importers of `#/components/ui` are the dev catalogue
  (`src/routes/foundations.tsx:48`), the three legacy kit files the adoption guard
  allow-lists, and `src/components/extensions/extension-slots.tsx` (also
  allow-listed). So every generic job the v3 kit lacks is hand-rolled or raw HTML
  inside v3 code.
- **Two facts about the "already planned" list.** Sortable has landed as a
  registry item (`src/components/reui/sortable.tsx`, 471 lines) with a measured
  record, and its decision is "adopt in a follow-up change" — it is not yet in
  the product. Stepper, Tree, Kbd and Empty have v3 twins already
  (`ui/stepper.tsx`, `ui/tree.tsx`, `ui/kbd.tsx`, `ui/empty-state.tsx`), so those
  rows are internal consolidation, not new imports; the plan's Stepper row should
  be read that way.

## Exclusions held

Reported as found; nothing below proposes them.

| Exclusion (source)                                        | What the scan found                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sheet grid — `@sheetbase-labs/sheetbase-table` (ADR-0048) | Present as expected: `src/components/sheet/sheetbase-table-grid-client.tsx`, `canonical-sheet-workspace.tsx`, `scientific-sheet-block.tsx`. No candidate proposed.                                                                                                                                                                                                |
| Figure renderers — `src/components/viz/**`                | Charts, `analysis-panel.tsx`, `chart-configurator.tsx`. `role="img"` progress meters and `Showing … of …` sampling notes live here; treated as domain surfaces, not candidates. No candidate proposed.                                                                                                                                                            |
| Scientific status vocabulary (ADR-0011)                   | `src/components/v3/ui/status.tsx` is the v3 vocabulary (tone + dot + text, never colour alone) and is used consistently. No candidate proposed.                                                                                                                                                                                                                   |
| `sheetbase-advanced-search` filter builder                | Its only in-tree use is the dev-only catalogue `src/routes/sheetbase-components.tsx:4-5`. The plan's exclusion stands for the FilterBuilder surface. One **adjacent** finding is flagged, not proposed: the list toolbars' Filter menu (`src/components/v3/inventory/list.tsx:156-175`) is a filter affordance and must wait for the filter-model reconciliation. |
| Notebook blocks and their chrome (Part A)                 | `src/components/notebook/**` was not scanned for candidates. Two findings touch it only as evidence of a shared job (`Textarea` imported from an inventory-area file at `block-editor.tsx:38`).                                                                                                                                                                   |
| Empty states (owner decision, plan §11.2)                 | `ui/empty-state.tsx` plus 91 call sites; findings recorded in the plan, untouched here. The empty states encountered in this scan (dataset tabs, sessions, deliveries, policies) are consistent with it.                                                                                                                                                          |

## How the ranking works

Rank order is _worth doing × what it buys_: how many hand-rolled copies exist, how
much maintenance is ours, whether a named behaviour is missing, and whether the
fix is one component or a migration. Each entry names the ReUI catalogue item it
would match, the evidence with paths and counts, what is materially worse today,
the verdict, and the Storybook position.

## Ranked candidates

| #   | Job                                             | Where we hand-roll it (count)                                                                                                                        | ReUI item                                      | Materially worse because                                                                                         | Verdict                                                                                   | Story today                                                                 |
| --- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 1   | Paging a list (page links **and** load-more)    | 4 page footers + 6 load-more controls in v3 surfaces (10 sites, 3 further peers outside v3)                                                          | Pagination (stock shadcn on the same index)    | No paging semantics at all; four copies of the same footer; controls vanish instead of disabling                 | **Worth doing.** Adopt for the page footers; keep load-more a Button+count                | Legacy story only (`src/stories/Pagination.stories.tsx`) → new story needed |
| 2   | Select (native, styled)                         | 2 styled exports in two different area folders + 2 raw `<select>` inside v3 + 3 in `settings/access.tsx`. 38 files import the one in `projects/`     | Native Select (stock shadcn)                   | Two homes for one job that differ in chevron, mobile height and invalid handling; raw copies lose all of it      | **Worth doing.** Consolidate to one v3 primitive; check the item's native semantics first | Legacy story (`Select.stories.tsx`) → new story needed                      |
| 3   | Progress                                        | 4 renderings: 1 correct `role="progressbar"`, 2 `role="img"` + prose label, 1 bare text percentage                                                   | Progress                                       | Two of four announce as an image with a sentence, not a progressbar; three bar styles, three fills               | **Worth doing** for single-value bars; keep the sample-domain segment bar separate        | Legacy story (`Progress.stories.tsx`) → new story needed                    |
| 4   | Breadcrumb trail                                | 24 files pass `crumbs=`, 57 occurrences; the separator idiom is hand-spelled in 12 route files                                                       | Breadcrumb (stock shadcn)                      | No `ol`/`li`, no `aria-current` on the last crumb, separator is a text node in the a11y tree; 12 spellings       | **Worth doing**, cheapest as a `PageHeader` trail prop                                    | Legacy story (`Breadcrumb.stories.tsx`) → new story needed                  |
| 5   | Code / payload block                            | 1 in-house `CodeBlock` + 3 ad-hoc `<pre>` renderers (4 total)                                                                                        | Code Block                                     | Four class strings, three unlabelled, none copyable — including the JSON payloads people paste into bug reports  | **Worth doing**, with the no-highlighter decision respected                               | No story                                                                    |
| 6   | Disclosure (collapsible section / row expander) | 3 `<details>` in v3 (9 files / 12 occurrences tree-wide) + 1 row expander that manages its own expanded state                                        | Collapsible / Accordion                        | `<details>` is fine; the row expander toggles a label with no `aria-expanded` on the control                     | **Worth doing at low priority** — consistency, not a missing behaviour                    | Legacy story (`Accordion.stories.tsx`) → new story needed                   |
| 7   | Command/listbox reconciliation (in-house)       | 2 implementations of a grouped keyboard list: `ui/command.tsx` (465 lines, 4 consumers) and `search-palette.tsx` (664 lines, own combobox + listbox) | Command (stock shadcn)                         | Two implementations of one job; ~200 lines of list/keyboard logic inside a screen compete with the kit component | **Worth doing as reconciliation**, not as a ReUI swap                                     | Legacy `Command.stories.tsx` → new story needed                             |
| 8   | Chip / toggle pill (in-house)                   | 5 renderers: removable chip, toggle chip, palette toggle pill, settings nav pills, portal nav pills                                                  | none (Toggle Group/Button Group are not chips) | Three near-identical class strings; no shared variants for removable/toggle/nav                                  | **Worth doing as an in-house component**                                                  | No story                                                                    |

Candidates 7 and 8 have no ReUI item for the job as such; they are ranked here
because the owner asked for componentisation wherever several versions exist. The
full in-house list follows the candidate detail.

---

## 1. Paging a list

**Two paging models, ten sites.**

Page footers — "Showing {start}–{end} of {total} {noun}" plus `Previous` / `Next`
router links:

- `src/routes/projects/$projectId/experiments.tsx:157-186`
- `src/routes/projects/$projectId/datasets.tsx:136-165`
- `src/routes/projects/$projectId/samples.tsx:141-170`
- `src/routes/projects/$projectId/files.tsx:270-300`

All four render the same block inside the `footer` prop of
`ProjectList` (`src/components/v3/projects/project-list.tsx`), and all four get
their arithmetic from the shared helper `projectPageSummary`
(`src/components/v3/projects/project-lists.ts:79-87`). The arithmetic was already
recognised as shared; the **markup was copied anyway**, which is the maintenance
burden: a change to the disabled rule or the label is four edits.

Load-more controls (cursor / growing window), six in v3 surfaces:

- `src/routes/search.tsx:438-448` — Button, "Loading…" while fetching
- `src/routes/experiments.tsx:533-540` — Button, raises a `limit`
- `src/routes/datasets/$datasetId/rows.tsx:349-380` — "Showing N of M rows" + "Load more (N left)"
- `src/routes/datasets/$datasetId/compare.tsx:374-386` — "Load more (N left)"
- `src/components/v3/integrations/enterprise-source-panel.tsx:436-446` — continuation token
- `src/components/v3/datasets/dataset-history-tab.tsx:53-56` — delegates to `ObjectHistoryTimeline`

Three further peers do the same job outside v3:
`src/components/audit/object-history-timeline.tsx:302`,
`src/components/audit/audit-trail.tsx:164-170`,
`src/components/sheet/canonical-sheet-workspace.tsx:2016`.

**What is materially worse.** There is no paging semantics anywhere: no
`nav aria-label="pagination"`, no current page, no page count, no disabled
"Previous" — at page 1 the link is simply absent, so the control row shifts and
a keyboard user cannot tell a first page from a missing control. Four copies of
one footer, and label divergence already exists across the load-more side
("Loading…", "Loading more…", "Load more (N left)").

**Verdict.** Worth doing. The page footers are the target — a `Pagination`
(stock shadcn item on the ReUI index; install by bare name, plan §11.3.4) or a
v3 `Pager` that keeps the router-link model. The load-more sites are a Button and
a count; they do not need the component and a component that tries to cover both
models will fit neither.

**Story.** `src/stories/Pagination.stories.tsx` exists and imports the **legacy**
`#/components/ui/pagination` — it does not cover whatever the v3 screens compose.

## 2. Select

**Four v3-internal renderings of one job, in two homes.**

- `src/components/v3/projects/select.tsx:5-25` — `NativeSelect`: a styled
  `<select>` plus a chevron; rendered by 39 files (127 occurrences), imported by
  38 — including legacy-area consumers such as `viz/chart-configurator.tsx` (9),
  `viz/analysis-panel.tsx` (9), `notebook/block-editor.tsx` (14) and
  `import/import-flow.tsx` (6). Its own doc comment says "Wrap in `<Field>`
  (a `<label>`) so it gets its name".
- `src/components/v3/inventory/list.tsx:387-404` — `Select`: the same job as a
  second definition, and it differs: no `appearance-none`, no chevron, a
  mobile-size branch (`max-md:h-10`) and a `invalid` prop instead of the
  `aria-invalid` pass-through, and it is born inside a table-toolbar file.
- `src/components/v3/models/record-model-records.tsx:144-156` and `:157-169` —
  raw `<select>` with `h-8 … text-label`, no chevron, no invalid treatment, in a
  toolbar beside `Input` and `Button`.
- `src/components/v3/settings/workspace-groups.tsx:104-118` — raw `<select>`,
  default browser chrome.

In v3-composed route screens the raw copy continues:
`src/routes/settings/access.tsx:193,208,458` (three: the first two inside a plain
`<label>`, the third inside a `Field`, none with the styled wrapper),
and four more in `src/routes/settings/members.tsx` (raw-select count per file:
access.tsx 5, members.tsx 4, templates `in-use` 2, dataset `compare` 2,
milestones 2).

**What is materially worse.** A _primitive_ is imported from an area folder:
39 files — including the notebook block editor and the sheet block — reach into
`#/components/v3/projects/select` for a select. The second definition in
`inventory/list.tsx` means two vocabularies for one control. The raw copies lose
the chevron, the 30px height, the focus ring and the `aria-invalid` treatment, so
the same form can show a styled and an unstyled select side by side.

**Verdict.** Worth doing — the highest-blast-radius small win in the scan. Target
the _native_ item (`Native Select` on the ReUI index, stock shadcn, base-nova):
the repository's stated reason for choosing native anyway —
`inventory/list.tsx:387`, "Native keeps keyboard and screen reader behaviour for
free" — is exactly what a JS listbox would trade away, so an adoption of ReUI's
`select` (Base UI popover listbox) would be a tactical change of behaviour and
needs a comparison row of its own. Either way, the consolidation is the point: one
v3 primitive, `Field`-aware, with the toolbar size as a variant.

**Story.** `src/stories/Select.stories.tsx` exists against the legacy kit; the v3
primitive needs its own.

## 3. Progress

**Four renderings, one of them correct.**

- `src/components/v3/samples/sample-hold-meter.tsx:179-196` — correct:
  `role="progressbar"` with `aria-valuemin` / `aria-valuemax` / `aria-valuenow`,
  fill changes by state (`bg-danger-text` when expired).
- `src/components/v3/home/home-quiet.tsx:281-300` — `role="img"` with a prose
  `aria-label` ("`{n}` of `{m}` experiments approved"), single success fill, no
  value semantics.
- `src/components/v3/samples/sample-usage.tsx:58-76` — `role="img"` with a prose
  label; a three-segment bar (used / reserved / free).
- `src/routes/instruments/$instrumentId.tsx:533-535` — the Runs table's Progress
  column renders the bare text `{r.progressPercent}%`.

**What is materially worse.** An assistive-technology user hears a sentence
instead of a progressbar value on two of the four, and the instrument Runs table
shows no visual progress at all where the design intent is a bar. Three bar
renderings, three heights and fills (`h-1.5 rounded-full bg-success`,
`h-2.5 rounded-sm` two-tone, `h-1.5 rounded-full bg-skeleton` + state fill).

**Verdict.** Worth doing for the single-value cases (project approval,
instrument run). The sample **usage** bar is domain semantics — a quantity ledger
readout (used / reserved / free, `sample-usage.tsx:8-13` documents the API
relationships) — and should either stay its own component or become a stacked
variant owned by the sample domain, never a generic determinate bar. ReUI
`Progress` gives the aria contract, indeterminate support and one fill vocabulary;
an in-house `Progress` derived from `sample-hold-meter.tsx:179-196` would clear
the same bar more cheaply if the item's restyle is not wanted.

**Story.** `src/stories/Progress.stories.tsx` exists against the legacy kit.

## 4. Breadcrumb trail

**One nav owner, 24 call sites, 12 separator spellings.**

`PageHeader` owns the `<nav aria-label="Breadcrumb">` and the crumb line
(`src/components/v3/ui/layout.tsx:39-46`). The trail itself is passed as a React
node by each screen: 24 files pass `crumbs=`, 57 occurrences across them (each
screen usually spells two — its loading/not-found one-crumb variant and its real
one). The separator idiom —

```tsx
<Link to="/projects" className="text-link">Projects</Link>{' '}
/ <span className="mono">{project.displayId ?? project.key}</span>
```

— appears in 12 route files, one per file: `datasets/$datasetId.tsx`,
`evidence/$revisionId.tsx`, `experiments/$expId.tsx`,
`instruments/$instrumentId.tsx`, `models/$modelId.tsx`,
`pipelines/$pipelineId.tsx`, `pipelines/$pipelineId/runs/$runId.tsx`,
`projects/$projectId.tsx`, `protocols/$protocolId.tsx`, `samples/$sampleId.tsx`,
`settings/integrations/$connectorId.tsx`, `templates/$templateId.tsx`.

**What is materially worse.** The trail has no list structure, so the
accessibility tree reads "Projects / PROJ-0001" as one run of text with the
separator as content; the last crumb carries no `aria-current="page"`, so the
"you are here" half of a breadcrumb is missing; and 12 screens own their own
spelling of the same separator, with the identifier wrapping rules open-coded at
each site (`<span className="mono">`, `truncate` on the nav).

**Verdict.** Worth doing, and the cheapest shape is not a component swap: change
`PageHeader` to take a trail (`{label, to}[]` plus the current crumb) so the 24
call sites stop passing markup, and render it as `ol`/`li` with `aria-current`.
Satisfying that with the stock shadcn `Breadcrumb` item is equally valid if the
item's ownership of the nav element is reconciled with `PageHeader`'s.

**Story.** `src/stories/Breadcrumb.stories.tsx` exists against the legacy kit.

## 5. Code and payload blocks

**One deliberate in-house component, three ad-hoc `<pre>`s.**

- `src/components/v3/pipelines/pipeline-code.tsx:55-116` — `CodeBlock`: language
  label, focusable scroll region (`tabIndex={0}`, `role="group"`, aria-label),
  empty-statement state, and a **documented decision** at `:9-21` that
  highlighting is deliberately deferred (no highlighter is a dependency).
- `src/components/v3/pipelines/agents/agent-surface.tsx:117-126` — `JsonValue`
  before/after blocks in the "Proposed diff" (`max-h-40`, `text-[11px]`).
- `src/components/v3/integrations/run-history.tsx:201-208` — the run's technical
  result payload, inside a `<details>`, `max-h-40`.
- `src/components/v3/settings/parser-settings.tsx:242-246` — parser output
  sample, `max-h-[240px]`.

**What is materially worse.** Four class strings and four max-heights; three of
the four have no label, no empty state and no copy affordance; the two JSON ones
are precisely what a person copies into a bug report or a support thread. The
in-house `CodeBlock` is the closest thing to a component and is not exported from
the kit, so nothing else can use it.

**Verdict.** Worth doing. Two acceptable shapes: adopt ReUI `Code Block` (check the
item's dependencies first — if it pulls a syntax highlighter, the documented
decision at `pipeline-code.tsx:20-21` has to be revisited by the owner, not
side-stepped), or promote the existing `CodeBlock` to `src/components/v3/ui/` with
a copy button and use it in the three `<pre>` sites. Per plan §11.3.4, read the
item's own install command before assuming a slug.

**Story.** None.

## 6. Disclosure

**Three `<details>` in v3, one imperative expander.**

- `src/components/v3/integrations/run-history.tsx:201-208` — "Technical result payload".
- `src/components/v3/settings/parser-settings.tsx:238-246` — parser sample output.
- `src/components/v3/projects/projects-page.tsx:1385-1404` — "Agreement and start
  date", a disclosure **inside the New project form**, wrapping two `Field`s.
- Expander: `src/components/v3/integrations/run-history.tsx:150-157` +
  `ExpandedRunRow` (`:161-225`) — the table owns a single-open `expandedRun`
  (`:60-61`) and renders a quiet Button labelled `Show`/`Hide`; the expanded
  content is a sibling `<tr>`.

Six further `<details>` exist outside v3 (`settings/signatures.tsx` 2,
`viz/chart-renderer.tsx` 2, `sheet/scientific-sheet-block.tsx` 2, plus
`audit/object-history-timeline.tsx`, `notebook/block-editor.tsx`,
`sheet/scientific-api-inspector.tsx`).

**What is materially worse.** The three `<details>` are honest native disclosure —
accessible, keyboard-operable, free — so the gain there is chrome consistency
(chevron, spacing, an open/close affordance that matches the rest of the app) and
the ability to put a control beside the summary. The row expander is the real
case: it is a control with no `aria-expanded`, whose label is the only state
signal, and the expanded content is a table row that must remember to carry the
right `colSpan` by hand.

**Verdict.** Worth doing at low priority — consistency, not a missing behaviour,
which is why it ranks below paging, select and progress. One `Disclosure` (ReUI
`Collapsible`/`Accordion` or in-house) should serve all four, including the
table-row expander, which is the one place with a real accessibility defect.

**Story.** `src/stories/Accordion.stories.tsx` exists against the legacy kit.

## 7. Command and listbox — one job, two implementations

- `src/components/v3/ui/command.tsx` (465 lines) exports `Command`, `CommandInput`,
  `CommandList`, `CommandGroup`, `CommandItem`, `CommandEmpty`, `CommandLoading`,
  `CommandSeparator`, `CommandFooter`, `CommandDialog`, `CommandPopover` and
  `optionId`; composed by four files: `record-picker/record-picker.tsx:13`,
  `scientific/record-picker.tsx:27`, `sheet/sheet-record-picker.tsx:14`,
  `notebook/add-block-menu.tsx:13`.
- `src/components/v3/search/search-palette.tsx` (664 lines) hand-rolls the same
  job: its own `role="combobox"` input (`:380-397`, with
  `aria-activedescendant`) and its own `role="listbox"` / `role="option"` list
  (`:527-610`) with `activeIndex`, `onMouseMove` selection and its own header
  controls (`NativeSelect` scope at `:400-412`, an inline toggle pill at
  `:414-430`).

**What is materially worse.** Two implementations of a grouped, keyboard-driven
option list in one tree, one of them living inside a screen. The palette's
behaviour (↑/↓, Enter, ⌘Enter, Esc, activation) is re-implemented rather than
composed, so the two will drift; `Command`'s four consumers get fixes the palette
will not.

**Verdict.** Reconciliation, not a ReUI swap — unless the reconciliation
concludes the kit's `Command` should be replaced by the stock item, which would be
a one-for-one replacement and a comparison row of its own. Caveats worth stating
before anyone starts: the palette is a port of the app-3 design (`:36` records it), it carries features `Command` may not have (scope select, archived scope,
`search_did_you_mean`, fetch-as-you-type), and `Command` is what four screens
compose today. The parity canvases under `docs/knowledge/design/ui-system-v3/`
are the reference for any change to it.

**Story.** `src/stories/Command.stories.tsx` exists against the legacy kit.

## 8. Chip and toggle pill (in-house)

| Renderer                   | Path                                                        | Shape                                                                                                            |
| -------------------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Removable filter chip      | `src/components/v3/projects/chip.tsx:4-26`                  | `h-6`, `border-border`, 18px `x` button with `aria-label`                                                        |
| Toggle chip (filter/scope) | `src/components/v3/record-picker/record-picker.tsx:267-298` | `h-7` (`max-md:h-9`), `aria-pressed`, optional icon and count, selected = `border-selection-border bg-selection` |
| Toggle pill (search scope) | `src/components/v3/search/search-palette.tsx:414-430`       | the record-picker chip's class string, inline, not the component                                                 |
| Nav pill (settings, phone) | `src/routes/settings.tsx:65-88`                             | `h-8` (`max-md:h-9`), `aria-current="page"`, selected = same token pair                                          |
| Nav pill (client portal)   | `src/routes/client-portal.tsx:501-518`                      | `h-9`, two full class branches instead of a `cn()` conditional                                                   |

**What is materially worse.** Three class strings for one visual idea, two sizes
for the same mobile treatment, and one of the five is a copy of another's string
rather than a shared export. The selected-state token pair is at least consistent
(`border-selection-border bg-selection`) — this is DRY and variant coverage, not a
defect. ReUI's `Toggle Group` and `Button Group` are not this job; do not adopt
them for it.

**Verdict.** In-house component: `Chip` with `removable` / `toggle` / `nav`
variants and a size axis. Story: none.

---

## In-house jobs to componentise

Jobs with several hand-rolled versions for which the ReUI catalogue has no item
(or where the catalogue's nearest item would be the wrong shape). Ranked the same
way: how many copies, how much maintenance is ours, what one component's API must
cover.

| #   | Job                                           | Implementations (count, paths)                                                                                                                                               | What one component's API must cover                                                                                                                                                                                         | Story today |
| --- | --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | List/table screen chrome                      | `src/components/v3/inventory/list.tsx` (500 lines, **12 exports**) imported by **28 files**, 8 of them outside the inventory area                                            | Header (title, total, actions, tabs) · toolbar (settled search, sort/filter/fields, right slot) · footer (count + bulk-selection slot) · skeleton (columns, inspector flag) · sticky first cell/head · mobile rows          | None        |
| 2   | Credential panel (token + service credential) | `settings-api-tokens.tsx` (314) and `settings-service-credentials.tsx` (313) — identical but for the function name                                                           | Item shape (name, prefix, scopes, created, last used, expires, status, actions) · create dialog copy · reveal-once `Secret` · revoke/rotate actions                                                                         | None        |
| 3   | Chip / toggle pill                            | 5 (see candidate 8)                                                                                                                                                          | `removable` · `toggle` (aria-pressed, icon, count) · `nav` (aria-current) · sizes                                                                                                                                           | None        |
| 4   | Form primitives (select, textarea, field)     | 2 select definitions + 2 raw `<select>` in v3; 1 shared `Textarea` + 2 raw `<textarea>`; `Field` already in `ui/input.tsx`                                                   | native-first select · textarea · invalid/disabled/size variants · error + hint wiring through `Field`                                                                                                                       | None        |
| 5   | Step chrome                                   | `ui/stepper.tsx` (1 call site: `components/import/import-flow.tsx:11`) + `agent-surface.tsx:561-591` + `pipeline-code.tsx:166-190` + legacy `audit/approval-stepper.tsx:127` | steps with state (todo/now/done/failed) · horizontal vs vertical · per-step status label · optional action/link per step                                                                                                    | None        |
| 6   | JSON / payload viewer                         | 4 (see candidate 5)                                                                                                                                                          | value + label · before/after pair · max-height · copy · truncation notice                                                                                                                                                   | None        |
| 7   | Quantity entry + validation                   | `samples/withdraw-dialog.tsx:175-245` (`QuantityKeypad`) + `:43-93` (format/parse/validate), used by both dialogs, with repeated quantity+unit+experiment fields             | amount + unit · locked unit from the balance · validation message and "remaining after" · mobile numeric keypad entry · Overlaps the planned Number Field — decide whether Number Field's stepper/scrub replaces the keypad | None        |
| 8   | Page heading chrome                           | `ui/layout.tsx:6-66` (`PageHeader`) + `inventory/list.tsx:63-111` (`ListHeader`) + `projects-page.tsx:368-447` (bespoke h1 + count + New project + tabs + More)              | title · count · actions · tabs slot · crumbs/trail · the H1/H2 level rule                                                                                                                                                   | None        |
| 9   | Link-style button / inline action             | `agent-surface.tsx:577-583`, `:634-640`, `routes/inbox.tsx:584`                                                                                                              | a `Button variant="link"` (or `quiet` with tighter padding) — a variant, not a component                                                                                                                                    | None        |
| 10  | Local banner (success / review)               | `home-quiet.tsx:106-136` — two banners that re-spell `Notice` (`ui/alert.tsx:28-68`) with an icon tile and a link action                                                     | `Notice` with an optional icon tile and an action slot already exists; use it                                                                                                                                               | None        |

**Item 1 detail — the list chrome is the biggest consolidation.** It is not only
exports: `inventory/list.tsx` owns `SearchTabs` (`:27`), `ListHeader` (`:63`),
`ViewControls` (`:124`), `FieldsButton` (`:207`), `ListToolbar` (`:241`),
`ListFooter` (`:317`), `ListSkeleton` (`:335`), `Select` (`:388`), `Textarea`
(`:406`), `MobileList` (`:432`), `stickyHead`/`stickyCell` (`:497-499`). Its
importers include every v3 registry list (`samples.tsx:47`, `materials.tsx:46`,
`models.tsx:37`, `protocols.tsx:36`, `templates.tsx:50`, `datasets.tsx:39`,
`pipelines.tsx:48`, `instruments.tsx:46`, `analysis/index.tsx:9`) **and** files
that are not lists at all: `components/notebook/block-editor.tsx:38` (Textarea),
`components/sheet/scientific-sheet-block.tsx:25` (Textarea),
`routes/client-portal.tsx:25` (Textarea),
`routes/models/$modelId/edit.tsx:18` (Textarea),
`routes/datasets/$datasetId.tsx:12` (SearchTabs),
`routes/datasets/$datasetId/snapshots.tsx:34` and `compare.tsx:22`
(`stickyCell`/`stickyHead`),
`routes/instruments/$instrumentId.tsx:34` (`Select`, `Textarea`),
`routes/templates/$templateId/index.tsx:22` (`Select`),
`src/components/v3/models/model-approval-panel.tsx:18` (`Textarea`).
Two named behaviours ride on it and both are currently local:
`ListFooter`'s `max-xl:mr-28` (`:328`) is the inspector-button dodge the plan
already flagged, and `ListToolbar`'s 200 ms settle (`:25`, `:289`) is the debounce
the plan found copied between screens. The API boundary with the planned
**Frame + Data Grid** work should be decided once: Frame owns the frame around
content, this owns the screen-level list chrome, and a table screen then reads
Frame + Data Grid + this + Pagination.

**Item 2 detail — the credential panels are a copy.** Structural diff of the two
files returns exactly one line (`settings-api-tokens.tsx` vs
`settings-service-credentials.tsx`, function name only). Both render
Name/Prefix/Scopes/Created/Last used/Expires/Status/Actions
(`api-tokens.tsx:194-205` ≈ `service-credentials.tsx:191-202`). One component with
a props object (scope vocabulary, item source, create copy, reveal-once secret)
would delete ~300 lines and any future divergence.

---

## Checked, no opportunity

Negative results, recorded so the next reader does not repeat the pass. Each names
what was searched and what was found.

| Job                                                                                  | Searched                                                             | Found                                                                                                                                                                                                                                                                                                                       | Why no opportunity                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Drawer                                                                               | side panels, slide-overs                                             | `ui/sheet.tsx` with sides `left`/`right`/`bottom`/`auto`; `Inspector` composes it for laptop/phone (`ui/layout.tsx:63-96`)                                                                                                                                                                                                  | A v3 twin already covers the job; nothing is hand-rolled                                                                                                                                                      |
| Scroll area                                                                          | custom scrollbars, bounded panels                                    | 7 `[scrollbar-width:none]` horizontal strips (`ui/tabs.tsx:16`, `ui/layout.tsx:61`, `inventory/list.tsx:93`, `projects-page.tsx:396`, `record-picker.tsx:140`, `settings.tsx:67`, `client-portal.tsx:502`) + 6 `max-h-*` scroll panels                                                                                      | Native scrolling is deliberate and defended (keyboard, find-in-page, print); a JS scroll area would trade those for styled scrollbars, and the strips are a two-class utility, not a component job            |
| Spinner                                                                              | `animate-spin`, `Loader2`, loader icons                              | Zero in `src/components/v3/**`. Loading is `Skeleton` (`ui/table.tsx:63`, `ui/command.tsx:353`, `inventory/list.tsx:335`) and text states ("Loading…": `dataset-imports-tab.tsx:108`, `settings-sessions.tsx:79`, `run-deliveries.tsx:114`)                                                                                 | Nothing is hand-rolled to replace, and a spinner beside skeletons would add a second loading language. If one is wanted, it is a design decision made with the Skeleton family, not an opportunistic adoption |
| Context menu                                                                         | `onContextMenu`                                                      | Zero occurrences in `src`                                                                                                                                                                                                                                                                                                   | Nothing to replace                                                                                                                                                                                            |
| Hover card                                                                           | `onMouseEnter`, hover previews                                       | None. The only preview is `ProjectPeek` (`projects-page.tsx:1074-1160`), a click-opened `Inspector`                                                                                                                                                                                                                         | No hand-rolled hover card; adding one would be new interaction design, not a replacement                                                                                                                      |
| Icon stack (overlapping avatars)                                                     | `-space-x`, stacked avatars                                          | Only `Avatar` in the account menu (`shell/app-shell.tsx:880,884`); the notebook's `ContributorAvatars` is notebook chrome (excluded)                                                                                                                                                                                        | No v3 site                                                                                                                                                                                                    |
| Colour picker                                                                        | `type="color"`, swatches, palettes                                   | None; tones are a typed enum (`ui/status.tsx:5-15`)                                                                                                                                                                                                                                                                         | No colour-choosing UI in v3                                                                                                                                                                                   |
| Input OTP · Phone input · Rating · Carousel · Scrollspy                              | `otp`, `tel`, `type="tel"`, stars/rating, `scroll-snap`, `scrollspy` | Zero matches each in `src/components/v3/**`                                                                                                                                                                                                                                                                                 | Nothing to replace; all would be net-new chrome                                                                                                                                                               |
| Questionnaire                                                                        | Question-set forms                                                   | The nearest thing is the pipeline run prompt (`pipelines/run-prompt.tsx:204-399`): an author-typed field schema rendered as a form with typed answers, required flags and a decision. One implementation, singular, and its semantics (decision, reason, expiry, who is asked) are the ADR-0052 pause-for-a-person contract | Adopting a questionnaire component would replace nothing and put domain decision semantics behind a generic form; if it is ever wanted, the ownership question is the ADR, not the catalogue                  |
| Kanban (Board view)                                                                  | Boards, columns, drag between columns                                | No board implementation. The product names the intent and parks it: `inventory/list.tsx:150-153` renders a "Table" menu with `Board` disabled and `hint="Later"`                                                                                                                                                            | Nothing hand-rolled to replace. Recorded as product intent: if Board is built, ReUI `Kanban` is the only viable candidate, and it would be a new surface (and its own comparison row), not an adoption        |
| Message / bubble                                                                     | Chat, bubbles, `Message`, `Bubble`                                   | None. Agent surfaces are tables + inspector (`agent-surface.tsx:451-491`), the prompt panel is a form                                                                                                                                                                                                                       | No chat-shaped surface exists                                                                                                                                                                                 |
| File-type chips · attachment lists                                                   | `attachment`, `mediaType`, file kind                                 | **Zero** `attachment` matches in `src/components/v3/**`. File kind is a text column (`routes/projects/$projectId/files.tsx:235,261`) and a filename link (`dataset-imports-tab.tsx:154-167`)                                                                                                                                | Nothing hand-rolled to replace; a file-type chip or an attachment list would be net-new chrome on a thin surface. Revisit when a file surface is next built                                                   |
| Alert / banner                                                                       | Hand-rolled alert boxes                                              | `ui/alert.tsx` owns `Notice` (tone, title, action, icon) and `Banner` (page strip). The only hand-rolled banners are two in `home-quiet.tsx:106-136`                                                                                                                                                                        | v3 twin exists and is richer; the two home banners are an in-house composition slip (see the componentisation list, item 10), not a ReUI opportunity                                                          |
| Tooltips via `title=`                                                                | Native `title` attributes                                            | 29 v3 files carry `title=` (13 occurrences in `agent-surface.tsx`, 6 in `home-quiet.tsx`)                                                                                                                                                                                                                                   | `ui/tooltip.tsx` exists; this is internal composition, not a ReUI evaluation                                                                                                                                  |
| Resizable / slider / switch / toggle group / separator                               | `role="switch"`, `type="range"`, `<hr>`, separator, resize           | Zero matches in `src/components/v3/**`. The kit's closest relatives are `checkbox` and `radio-group`; the only toggle-shaped control is the chip family (row 8)                                                                                                                                                             | Nothing to replace; all would be net-new primitives with no screen asking for them                                                                                                                            |
| Charts, sheet grid, status vocabulary, filter builder, notebook chrome, empty states | —                                                                    | As expected by the plan and the ADRs                                                                                                                                                                                                                                                                                        | Exclusions held; nothing proposed (see Exclusions table)                                                                                                                                                      |

## Storybook position

- 77 stories exist. 54 import the legacy `#/components/ui/**` kit directly; the
  rest cover legacy-area or scientific components. **Across all 77, the only v3
  kit module imported anywhere is `button` (in 19 stories)** — so no story covers
  a v3 primitive as its subject, and the stories named Pagination, Progress,
  Breadcrumb, Select, Accordion and Command all exercise the legacy Radix kit.
- Only three stories live in a v3 area folder
  (`models/record-model-versions.stories.tsx`, `protocols/protocols.stories.tsx`,
  `settings/parser-versions.stories.tsx`).
- Therefore **every candidate in this scan needs a new story**; none is covered by
  the legacy story of the same name.
- `pnpm validate` is `check + lint + typecheck + test + build` and the workflows
  under `.github/workflows/` do not run Storybook, so a story is documentation
  today (plan §11.5 says the same). If a story is to be part of the deliverable
  rather than a manual artefact, it needs a check that runs it — otherwise
  "a story stands in" stays a statement of intent.

## Limits

- Source reading only. No render, no browser, no axe, no test run. Nothing here
  was executed.
- Counts are exact at `35423ec` and will drift. Line numbers are given so they can
  be re-checked.
- ReUI catalogue facts (item names, free tier, the Base UI build) come from the
  plan's revision 5 and this thread's catalogue, not from a fresh read of the
  registry. Per §11.3.4, each item's own install command must be read before an
  adoption, and the two traps in §11.5 apply here too: a copied item using
  `bg-card` will render wrongly and still pass the colour check, and the adoption
  guard is keyed on a basename collision.
- No candidate here has been through the A/B harness or the behavioural checklist;
  "worth doing" is a sizing judgement from the source, not a verdict, and each
  adoption still needs its row in `component-comparison-record.md`.
