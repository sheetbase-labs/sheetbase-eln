---
title: Component comparison record — ADR-0055
status: living record — one row per compared component
last_reviewed: 2026-10-16
---

# Component comparison record

ADR-0055 decision 5 requires a ReUI comparison to be recorded as **one row per
component**: what we use now, what the registry offers, the result of the fixed
behavioural checklist on both sides, and the decision with its reason. Decision 4
gives the bar an adoption has to clear. This file is that record; it is the
durable artefact, not the component choice.

It exists because the previous ReUI adoption left nothing behind. An event
calendar was adopted (`3b0951fd`, `1b915579`), then deleted with the
legacy-shell routes it was used on (`9ced9f6d`), and no comparison survived — so
the second attempt could not be judged against the first, and neither reason
could be reconstructed. A row here is what stops that happening again.

The evidence comes from the comparison harness at `/component-compare`
(development-only; runbook [`docs/development/component-compare.md`](../../development/component-compare.md),
code `src/components/component-compare/`). The harness holds the fixtures, the
checklist and the two columns; this file holds the results and the decision.
Neither replaces the other: an adoption is not proposed here, and a row without
a decision is not a record.

## Rows

| #   | Component (generic UI job)                              | What we use now                                                                                                                                                                   | What ReUI offers                                                                           | Checklist result                                                                                                                                                                                                                                                                                                   | Decision                                                                                                         | Measured    |
| --- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Reorderable list — reorder rows by pointer and keyboard | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row) | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx` | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 8 items are not applicable — this pair has no sort, filter, select, resize or pagination control | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface | 16 Oct 2026 |

| 2 | Registry table — a list of records with sorting, row selection and a pinned first column | The seven untouched registry screens hand-roll the same `v3/ui/table` body inside the shared chrome in `src/components/v3/inventory/list.tsx` (`src/routes/samples.tsx` and its siblings): sticky first column via `stickyHead`/`stickyCell`, click-only row selection, no keyboard path, no virtualisation. `/protocols` shipped this body until this change deleted its copy | `@reui/frame` + `@reui/data-grid` (base-nova pin), placed under `src/components/reui/`: virtualised rows, column and row pinning, a row-select checkbox column, and a frame with its own footer | Ours: 8 of the 9 applicable items pass; **`keyboard-select` fails** — no row selection is reachable without a pointer (see the detail table). Theirs: all 9 pass. 5 items are not applicable — this pair has no reorder, filter or resize control | **Adopt** on `/protocols`, which this change does: the bespoke body and the screen's `ListFooter` usage are deleted in the same change. The other seven registry screens keep their copy for now (see the limits of this row) | 16 Oct 2026 |

## Row 1 — Reorderable list (`notebook-sortable`)

### What we use now

`src/components/notebook/notebook-block-reorder.tsx` (240 lines): native HTML5
drag-and-drop, started at the row's grip handle and resolved on the row under the
pointer by comparing the pointer's Y with that row's midpoint; one insertion line
above or below the gap the drop would land in; keyboard reordering with
alt+arrow from the focused row. The row frame is the notebook's own
`NotebookBlock`.

In the notebook that grip handle is also the click target for the block menu.
This column passes no `menuItems`, so the handle here only drags and the column
has no "Block actions" trigger: the menu is document chrome, not part of the
reorder mechanism being compared.

Two facts about it that the measurements above turned on:

- The grip handle is desktop-only. `notebook-block.tsx` renders it inside
  `hidden w-7 … lg:flex`, so below 1024px the list offers **no pointer or touch
  reordering at all** — not a small handle, none. HTML5 drag-and-drop has no
  touch path either.
- The drag mechanics are ours to maintain: they existed inline in
  `notebook-document.tsx` and were extracted into this module by this change, so
  that the harness measures the code the product ships rather than a copy of it.
  `notebook-document.tsx` is the only other consumer.

### What ReUI offers

`src/components/reui/sortable.tsx` (471 lines, installed from
`@reui/sortable` at the pinned base-nova registry and placed by hand; the only
edit is the `cn` import re-pointed to `#/lib/utils`): `Sortable`,
`SortableItem`, `SortableItemHandle`, `SortableOverlay`. It wraps `@dnd-kit`:
mouse (10px activation), touch (250ms) and keyboard sensors, a drag overlay
rendered through a portal, a movement transform with layout animation instead of
an insertion line, live-region announcements while dragging, and `disabled` per
item.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. Applicable
items are the 10 whose control class (`reorder`) or state the pair has; the other
8 need sort, filter, select, resize or pagination controls that neither side of
this pair has, and are recorded as not applicable rather than skipped.

| Check                                                     | Ours                                                                                                | Theirs                                                                                                   | How it was measured                                                   |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass — grip handle (named "Drag block"), then each focusable row                                    | Pass — the handle button per row; the item container is deliberately not a tab stop                      | Browser, both columns                                                 |
| Reorder by keyboard                                       | Pass — alt+arrow from the focused row; the row's accessible name states the shortcut                | Pass — lift with Enter, move with arrows, drop with Enter; the candidate announces the row it is over    | Browser, both columns                                                 |
| Reorder by pointer                                        | Pass — drag from the handle; insertion line shows the gap                                           | Pass — drag from the handle past the 10px activation; overlay follows the pointer, order changes at drop | Browser, both columns; both produced the same order for the same drop |
| Empty (0 rows), loading, error, permission-restricted     | Pass (see the caveat below)                                                                         | Pass                                                                                                     | Browser (both columns) and jsdom                                      |
| Dark theme                                                | Pass — token-bound colours only; axe clean in dark                                                  | Pass                                                                                                     | axe in Chromium with colour contrast on, both columns and both themes |
| Density and overflow at 1440x900                          | Pass — no horizontal overflow, no clipped row, handle visible                                       | Pass                                                                                                     | Browser, both columns                                                 |
| Density and overflow at 390x844                           | **Pointer reordering is unavailable** — the handle is not rendered; keyboard reordering still works | Pass — the handle is rendered and usable                                                                 | Browser, both columns, asserted per column rather than averaged       |

Sort, filter, select, resize and pagination: not applicable to this pair (8
items). They are listed in the harness with that verdict and will be answered
when a pair that has those controls is added.

**Caveat on the empty, loading and error states.** These are picture states of a
whole screen, and the harness owns them: both columns show the same harness
notice for a 0-row fixture, for loading, and for a load failure. The notebook
does ship its own empty state — `notebook-document.tsx` renders the
"Start this Notebook" panel with its own controls when a record has no blocks —
but this column renders the reorder mechanism, not the whole document, so it
does not reproduce that panel; ReUI's `Sortable` ships no empty state at all.
Those three items therefore measure the column's containment and keyboard order,
not the shipped empty rendering. `restricted` is different: each column renders
its own disabled affordances, and those were compared.

### Automated evidence

| Evidence                                                                                           | Result                                                                                      | Command                                                                                          |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides                                       | 18 cases, **zero violations** (colour contrast disabled: jsdom cannot measure it)           | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`          |
| axe in Chromium, colour contrast **on**                                                            | 4 cases (2 columns × 2 themes), **zero violations**                                         | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser --grep axe` |
| axe, the candidate item unchanged, two handle renderings (C1)                                      | as published: clean; handle as a real `button`: `nested-interactive` (serious) on every row | same file, "the candidate rules or not on how its handle is rendered (C1)"                       |
| Harness contracts (one scenario object to both columns, frozen fixtures, keyboard reorder, states) | 12 tests, pass                                                                              | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`               |
| Full browser checklist (keyboard, pointer, states, density, 4 screenshots)                         | 18 tests, pass                                                                              | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser`            |

The 5,000-row fixture is rendered and measured for overflow in both columns in
the browser run, but it is not an axe target in either engine: one axe pass over
~25,000 nodes per column takes minutes (measured: 14.6 minutes for the four bulk
cases in Chromium alone) without exercising a rule that the same component's
smaller fixture does not already exercise. That exclusion is a deliberate,
recorded limit, not an omission.

Screenshots (`COMPONENT_COMPARE_SHOTS=<dir>`): `ours-light.png`,
`ours-dark.png`, `theirs-light.png`, `theirs-dark.png` — one per column per
theme, on the long-labels fixture. Appearance is evidence; it is not the verdict.

### What an adoption would cost — conditions

- **C1 — resolve where the drag's semantics live, and keep the fix-up.** The
  item puts `@dnd-kit`'s attributes on the row container (`role="button"`,
  `tabindex="0"`) while the drag listeners sit on the handle inside it, and the
  handle it renders by default is a non-focusable `<div>`. So:
  **as published the item is axe-clean** — nothing inside the widget it declares
  can take focus — and for that same reason its keyboard sensor is unreachable.
  Make the handle a real `<button>`, which an integration has to do for the
  keyboard path, and every row becomes a widget containing a control: axe
  reports `nested-interactive` (serious). Both halves are measured against the
  vendored item unchanged by
  `src/components/component-compare/component-compare.a11y.test.tsx`, "the
  candidate rules or not on how its handle is rendered (C1)". This column
  resolves it by handing the container the list's own semantics
  (`<ul>`/`<li>`, `role="listitem"`, `tabindex="-1"`) so the handle is the
  single control, and that resolution is what the per-column axe suite covers.
  An adoption must keep that override or move the attributes onto the handle in
  the copy, and must not drop the keyboard path while doing so.
- **C2 — verify touch on a device.** The harness measures the mouse path in
  desktop Chromium; `@dnd-kit`'s touch sensor (250ms hold, 5px tolerance) was not
  exercised. The touch path is the main reason the candidate clears the bar, so
  it needs a real device before the notebook's implementation is deleted.
- **C3 — accept the dependencies.** `@dnd-kit/core`, `@dnd-kit/sortable` and
  `@dnd-kit/utilities` join the application's dependencies, plus one
  copy-and-own file to maintain. The alternative is the 240 lines we maintain
  today.
- **C4 — decide the drop preview deliberately.** The candidate replaces the
  insertion line with a moving overlay. That is a design change to the notebook,
  not a like-for-like swap; the notebook's design-set row and its parity
  expectation must be updated with it.
- Plus the standing requirements from ADR-0055 decision 4: restyle to Sheetbase
  tokens, pass the colour check and the adoption guard, and replace the old
  implementation in the same change with no parallel implementation left behind.

### Decision and reason

**Adopt, in a follow-up change that satisfies C1–C4. Not adopted here.** ADR-0055
does not authorise an adoption, and this change adds no product surface: it adds
the harness, the fixtures, the checklist and this row.

The reason is a measured missing behaviour, not a preference. Below 1024px our
list cannot be reordered by pointer or touch at all — the handle is not rendered
(`hidden lg:flex`) and HTML5 drag-and-drop has no touch path — while the
candidate keeps a pointer/touch handle at every width, adds drag announcements
our version does not have, and removes 240 lines of drag mechanics we currently
own. That is ADR-0055 decision 4's second test, "a named behaviour is missing, or
the maintenance burden is demonstrably ours", met twice over.

The reason it is conditional is C1: the item's keyboard path is unreachable as
published, and making it reachable is what exposes its container semantics to
axe, so resolving where the drag's semantics live — and keeping that resolution
— is the adoption's work. If a future change decides the notebook
needs keyboard-only reordering below 1024px, the missing-behaviour half of the
reason disappears and this decision should be re-measured rather than inherited.

### Limits of this row

- Desktop Chromium only (Playwright, one worker); no Firefox, WebKit or real
  device was run.
- The comparison holds the row chrome constant on the candidate's side (it is
  restyled to Sheetbase tokens because an adoption means restyling anyway), so
  the row's _look_ is not what was compared; the reorder interaction is.
- The 5,000-row fixture is measured for rendering and overflow, not by axe.
- This row records one pair. It is not a verdict on `@dnd-kit`, on ReUI as a
  registry, or on any other ReUI item.

## Row 2 — Registry table (`registry-grid`)

### What we use now

`src/routes/samples.tsx` (503 lines) and six sibling screens render the same
registry body by hand: a `v3/ui/table` inside the shared chrome from
`src/components/v3/inventory/list.tsx`, with `stickyHead`/`stickyCell` classes
standing in for a pinned first column, `selected={…}` on the row plus an
`onClick` for selection, and the count in `ListFooter`. Sorting belongs to the
route: the toolbar's Sort menu writes a `sort` key and the route sorts the array
with `localeCompare(value, 'en-GB', { numeric: true })` before the table sees it.
There is no keyboard path to a row selection, no virtualisation, and the sticky
column is a `position: sticky` utility that the print and phone rules have to
know about.

`/protocols` shipped exactly this body (the eighth copy). This change deleted
that copy; the seven others are the implementation that still ships, and the
pair's ours column renders their markup verbatim.

### What ReUI offers

`src/components/reui/frame.tsx` and `src/components/reui/data-grid/**`, both
installed with the shadcn CLI from the pinned base-nova registry into a scratch
directory and placed by hand (ADR-0055 decision 2, §11.3.1 of the plan: a plain
install resolves the item's bare registry dependencies into the legacy Radix kit
at `#/components/ui`). `cn` is re-pointed to `#/lib/utils`, the items are
restyled to the app-3 token vocabulary the v3 kit writes, and their imports are
wired to the v3 twins that exist.

The grid is written against TanStack Table v9, which is why B3 landed first.
The build ships virtualised rows (`DataGridTableVirtual`), column and row
pinning, cell selection (`data-grid-cell-selection.tsx`), pagination, column
controls and a drag layer; row grouping is not in the free build.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. The pair
declares `sort` and `select`; the 5 items needing `reorder`, `filter` or
`resize` are recorded as not applicable.

| Check                                                     | Ours                                                                           | Theirs                                                                                     | How it was measured                                                                                        |
| --------------------------------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass — the sort picker, then each name link                                    | Pass — the sort picker, each row checkbox, then the name links                             | `tests/browser/component-compare.test.ts` (registry pair, keyboard)                                        |
| Sort without a pointer                                    | Pass — the shipped picker is a native select                                   | Pass — the same picker drives the table's sorting state                                    | same run; and `tests/browser/registry-grid.test.ts` for the screen                                         |
| Select a row without a pointer, and reach the selection   | **Fail** — rows are selected by clicking the row; nothing per row is focusable | Pass — focus the row checkbox, Space toggles it; the footer count and the inspector follow | same run; and `tests/browser/registry-grid.test.ts`                                                        |
| Sort by a column header, both directions                  | Pass — via the toolbar's Sort menu                                             | Pass — the same menu; the grid's own header is not used (see the costs)                    | `tests/browser/registry-grid.test.ts`                                                                      |
| Select a row, and select a second row                     | Pass                                                                           | Pass                                                                                       | same run                                                                                                   |
| Empty (0 rows), loading, error, permission-restricted     | Pass (see the caveat in row 1 — these are harness states, not the screen's)    | Pass                                                                                       | `src/components/component-compare/component-compare.a11y.test.tsx` (both columns, 6 fixtures and 3 states) |
| Dark theme                                                | Pass                                                                           | Pass                                                                                       | axe in Chromium with colour contrast on, both columns and both themes                                      |
| Density and overflow at 1440x900                          | Pass                                                                           | Pass                                                                                       | `tests/browser/component-compare.test.ts` (registry pair, density)                                         |
| Density and overflow at 390x844                           | Pass                                                                           | Pass                                                                                       | same run                                                                                                   |

Reorder, filter and resize: not applicable to this pair (5 items).

### Automated evidence

| Evidence                                                                                                     | Result                                                              | Command                                                                                                            |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides                                                 | zero violations (colour contrast disabled: jsdom cannot measure it) | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`                            |
| Harness contracts (one scenario object to both columns, frozen fixtures, the registered pair set)            | 12 tests, pass                                                      | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`                                 |
| axe in Chromium, colour contrast on, registry pair, both columns × both themes                               | 4 cases, zero violations                                            | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser --grep "registry table pair"` |
| Keyboard sort and keyboard selection, per column; density at 1440×900 and 390×844; four screenshots          | 11 tests, pass                                                      | same command                                                                                                       |
| The adopted screen: pinned column, ordering under each sort key, click and keyboard selection, the name link | 1 test, pass                                                        | `pnpm exec playwright test tests/browser/registry-grid.test.ts --project=browser`                                  |

Screenshots (`COMPONENT_COMPARE_SHOTS=<dir>`): `registry-ours-light.png`,
`registry-ours-dark.png`, `registry-theirs-light.png`,
`registry-theirs-dark.png`.

### What the adoption cost

- **C1 — the sort header is not adopted.** The item's sortable header
  (`DataGridColumnHeader`) is built on four dropdown-menu parts the v3 kit does
  not have (`DropdownMenuCheckboxItem`, `DropdownMenuSub`,
  `DropdownMenuSubTrigger`, `DropdownMenuSubContent`). Adding them to the shared
  kit is a change to the forward vocabulary with its own blast radius, so the
  screen keeps its own sort control (the toolbar's Sort menu, which now writes
  the table's sorting state) and the grid renders static headers. The gain the
  item would add — per-column sort, pin and move menus — is not claimed here.
- **C2 — the collation is passed in.** The bundle's `alphanumeric` built-in
  orders `AAV9 harvest clarification` before `AAV full/empty ratio by AUC`,
  where the registry's en-GB collation does not. The columns carry the screen's
  comparator as a `sortFn`, so the order under each sort key is what the bespoke
  body produced (verified both ways: `tests/browser/tmp-b4-order` in the
  working tree during the change, and the expectations pinned in
  `tests/browser/registry-grid.test.ts`).
- **C3 — one control has no v3 twin.** The item's pagination ships a Radix
  select for "rows per page". The app's convention for a small control is a
  native select in the input's style, so that one control is re-pointed rather
  than restyled; the copy says so where it happens.
- **C5 — the table's accessible name is an addition to the copy.** The item
  renders an unnamed `<table>`; the v3 table it replaces always carried one
  (`aria-label="Protocols"`). The copy adds a `tableLabel` to the item's i18n
  labels and applies it on the table element, and the screen passes
  `"Protocols"`. It is recorded here because it is an edit beyond an import-path
  fix, and because a name is what the screen's own unit test and a screen-reader
  user both read.
- **C4 — cell selection and row pinning are available, not enabled.** The
  screen's selection model is a row that the inspector follows; a cell-range
  gesture would compete with the row click that drives it, and the item's cell
  selection is a 2.6k-line controller with its own clipboard and edit contract.
  Both stay in the item, unused by this screen.
- Plus the standing requirements: restyled to Sheetbase tokens, colour check,
  axe and the adoption guard pass, and the old body is deleted in the same
  change.

### Decision and reason

**Adopt, on `/protocols`.** The reason is a measured missing behaviour, not a
preference: the bespoke body cannot select a row from the keyboard at all
(`keyboard-select` fails above, and the same body is copied across eight
screens), and it maintains its own pinned-column CSS, row chrome and count
footer per screen. The grid also renders rows through a virtualiser, which the
registry lists do not have today, and it replaces the `stickyHead`/`stickyCell`
utility pair with the item's pinning state.

The decision is deliberately scoped: `/protocols` is the first registry screen
**not** in the design-parity set, so this adoption needs no regenerated design
reference (the plan's §11.5 records that parity is red by construction while 81
boards are pending). The other seven screens are left untouched, and that is a
recorded limit of this row rather than a claim that the consolidation is done.

### Limits of this row

- The seven other registry screens still ship the body this row's ours column
  reproduces; only `/protocols` was migrated, so "no parallel implementation" is
  satisfied for the screen and not for the registry surface as a whole.
- Desktop Chromium only (Playwright, one worker); no Firefox, WebKit or real
  device was run. The phone width is measured at 390x844 with the desktop
  engine, and the screen's phone path is still `MobileList`, not the grid.
- The 5,000-row fixture is rendered in the harness (the a11y suite skips it for
  axe, per the runbook); virtualisation on a real 5,000-row registry screen was
  not measured.
- The item's own header, filter, drag and cell-selection layers were read but
  not adopted, so this row is not a verdict on them.

## Adding a row

Register the pair in `src/components/component-compare/pairs/index.ts` with its
job and its control classes, run the two vitest suites and the browser spec, then
add the pair's row above and its detail section with: what we use now, what the
candidate offers, the per-item checklist result for both sides, the automated
evidence with its commands, the conditions an adoption would carry, the decision
and the reason, and the limits. `docs/development/component-compare.md` has the
step-by-step.
