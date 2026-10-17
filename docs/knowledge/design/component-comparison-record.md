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

| #   | Component (generic UI job)                                        | What we use now                                                                                                                                                                                                                                                                                                     | What ReUI offers                                                                                                                                                                                                                                                                               | Checklist result                                                                                                                                                                                                                                                                                                                                                                                                  | Decision                                                                                                                                                                                        | Measured    |
| --- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Reorderable list — reorder rows by pointer and keyboard           | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row)                                                                                                                                   | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx`                                                                                                                                                                                                     | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 8 items are not applicable — this pair has no sort, filter, select, resize or pagination control                                                                                                | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface                                                                                | 16 Oct 2026 |
| 17  | Paging a list — move between pages, and say which rows you are on | Four byte-identical 26-line pager blocks, one per project tab: `routes/projects/$projectId/{experiments,datasets,samples,files}.tsx` (the arithmetic was already shared; the markup was copied)                                                                                                                     | `@reui/pagination` **is not a registry item** — the pinned base-nova registry returns `404 {"error":"Registry item not found","message":"pagination is part of shadcn/ui, not a ReUI item."}`. The nearest item is the stock shadcn `Pagination*` the repository already has in the legacy kit | Ours (`src/components/v3/ui/pager.tsx`, the survivor): all 6 applicable items pass, including keyboard paging (Tab to "Next", Enter moves the page and "Previous" turns live). Theirs (`src/components/ui/pagination.tsx`, restyled): all 6 pass too — its numbered links are keyboard-reachable and it pages. The decision is not carried by the checklist: see "What is materially worse" in the detail section | **Adopt the in-house `Pager`; the four copies are deleted.** Decline the stock `Pagination*` item (row 18) and record that `@reui/pagination` does not exist                                    | 16 Oct 2026 |
| 18  | Stock shadcn `Pagination*` (the only pagination on the index)     | Not used anywhere in the app: `src/components/ui/pagination.tsx` has a story and **zero** call sites (it is already half-migrated — it imports `buttonVariants` from the v3 kit)                                                                                                                                    | Nothing: this is the stock shadcn item reached by bare name, not a ReUI item (`@reui/pagination` 404s, row 17)                                                                                                                                                                                 | Checklist passes (see row 17), so this decision is not about the checklist. It is about the model: `PaginationLink` renders an `<a href>`, so paging would leave the router and full-reload the screen; it has no range or count (the design's footer is a count line, "11 of 17 files"); and it is numbered pages where the screens are 25-row windows                                                           | **Decline.** ADR-0055 decision 1: the legacy kit is not extended, and this change adds no new legacy import. The anchor model and the missing range label are the named defects                 | 16 Oct 2026 |
| 19  | Growing-window list control — read the next page of a list        | Six hand-rolled controls with five labels between them and no `nav` landmark: `routes/search.tsx`, `routes/experiments.tsx`, `routes/datasets/$datasetId/{rows,compare}.tsx`, `components/v3/integrations/enterprise-source-panel.tsx`, and the audit log's tail, which had **no control at all** in its idle state | No item: `@reui/load-more` answers `404 {"error":"Registry item not found"}` and ReUI's index has no load-more component. The job is a button and a count                                                                                                                                      | Ours (`src/components/v3/ui/load-more.tsx`): all 6 applicable items pass; one label, one count format, a landmark, and a keyboard path the audit tail did not have. Theirs (the deleted spellings, kept in the pair): passes 5 of 6 — the audit tail's 5000-row case leaves older entries reachable only by scrolling                                                                                             | **Adopt the in-house `LoadMore`; the six controls are deleted.** No registry candidate exists to compare against. Recorded as a consolidation, not a ReUI adoption                              | 16 Oct 2026 |
| 20  | List screen header — title, count, actions, views                 | `ListHeader` (`src/components/v3/inventory/list.tsx`) is composed by **eight** registry screens. Two more composed the identical band by hand, character for character: `routes/experiments.tsx:228-252` and `routes/inbox.tsx:406-462`                                                                             | Nothing: `ListHeader` is in-house and ReUI has no list-header item                                                                                                                                                                                                                             | Ours (`ListHeader`, with one new `subtitle` prop): all 6 pass. Theirs (the two hand-rolls): 5 of 6 — the inbox header has no count slot, so it wraps its title and subtitle in one row and puts the sentence beside the `<h1>`. Both wrap rather than clip at 390 (the 408px action measurement that produced the hand-rolled wrap is now the header's own rule)                                                  | **Adopt the migration.** The band, the wrap rule and the count format are the shared header's; neither screen is a special case once `ListHeader` can carry a subtitle                          | 16 Oct 2026 |
| 21  | Page location trail — say where the page is                       | The trail was markup each of **24 files** composed and passed as `crumbs`: 12 of them hand-spelled the `/` separator, none produced `ol`/`li`, and none marked the crumb you are on (`help/records.tsx` was the one place that did). The two help routes hand-rolled their own nav                                  | Nothing: ReUI's index has no breadcrumb; the stock shadcn `Breadcrumb*` is the legacy kit's (`src/components/ui/breadcrumb.tsx`, zero call sites)                                                                                                                                              | Ours (`src/components/v3/ui/breadcrumb.tsx`, rendered by `PageHeader trail`): all 6 pass — `ol`/`li`, a separator `aria-hidden`, `aria-current="page"` on the last unlinked crumb. Theirs (the node 24 files passed): 5 of 6 — jsdom axe flags `landmark-unique` when two hand-spelled trails sit in one column, and the separator is a text node in the accessibility tree                                       | **Adopt the in-house `Breadcrumb`; the `crumbs` node slot is deleted** (24 files migrated, no parallel implementation). The stock shadcn item is not taken, under the standing ruling in row 18 | 16 Oct 2026 |
| 22  | Settle-delay search box — hold typing still, then report          | Three copies of one debounce: `components/v3/inventory/list.tsx` (200 ms), `routes/datasets/$datasetId/rows.tsx` (a **verbatim copy including its comment**), `routes/settings/audit.tsx` (250 ms, a different shape)                                                                                               | Nothing: a hook, not a component — no registry item and nothing to render                                                                                                                                                                                                                      | Both sides are the same input, so there is nothing for a column to compare: the difference is where the 25 lines live. Evidence is the hook's own suite instead (`src/lib/settled-value.test.ts`, 5 cases: a burst reports once, no report on mount, an external change is adopted and the queued keystroke dropped, the echo of its own report is ignored, the settled value is held with no callback)           | **Adopt the shared hook; the three copies are deleted.** No pair is registered, because a pair whose two columns render identical controls measures nothing                                     | 16 Oct 2026 |

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

## Row 17 — Paging a list (`paging-a-list`)

### What we use now

Four byte-identical 26-line pager blocks, one per project tab —
`routes/projects/$projectId/{experiments,datasets,samples,files}.tsx` — each
inside the `footer` prop of `ProjectList`. The arithmetic was already shared
(`projectPageSummary`), the markup was copied: a `<span>` of "Showing {start}–{end}
of {total} {noun}", then `Previous` and `Next` as `text-link` router links that
**vanish** at the ends, so at page 1 the row moves and a reader cannot tell a
first page from a missing control. There was no `nav`, no landmark and no
`aria-label="Pagination"` anywhere in the tree.

The survivor is `src/components/v3/ui/pager.tsx`: a `nav[aria-label="Pagination"]`
carrying the same range label, with both ends always rendered and inert
(`disabled` on the router `Link`, which drops the `href` and sets
`aria-disabled="true"`; the dimmed style is the pager's own class, so a screen
that renders it outside the router still shows which end it is at). The
arithmetic stays the caller's — the page size, the parse and the range are
`project-lists.ts`'s policy.

### What ReUI offers

Nothing. `@reui/pagination` is not a registry item: the pinned base-nova
registry answers

```
GET https://reui.io/r/base-nova/pagination.json
404 {"error":"Registry item not found","message":"pagination is part of shadcn/ui, not a ReUI item. Install it with: npx shadcn@latest add pagination"}
```

and the shadcn CLI refuses `@reui/pagination` the same way. The nearest item is
the stock shadcn `Pagination*`, which the repository already has in the legacy
kit — that is row 18.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. The applicable
items are the 6 whose state or `pagination` control this pair has; the other 12
need reorder, sort, filter, select or resize controls and are recorded as not
applicable rather than skipped.

| Check                                                     | Ours                                                                                                                                | Theirs (stock `Pagination*`, restyled)              | How it was measured                                         |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass — the range label, then `Previous`, then `Next`                                                                                | Pass — `Previous`, the numbered links, `Next`       | Browser, both columns                                       |
| Move to the next and previous page without a pointer      | Pass — Tab to `Next`, Enter moves to "Showing 26–50 of 5000 rows"; at page 1 `Previous` is not a tab stop and reads `aria-disabled` | Pass — Tab to a numbered link, Enter moves the page | Browser (bulk fixture), both columns                        |
| Empty (0 rows), loading, error, permission-restricted     | Pass (harness-owned states; the pager renders nothing for a 0-row fixture)                                                          | Pass                                                | jsdom axe, both columns, and the browser run                |
| Dark theme                                                | Pass — token-bound colours only                                                                                                     | Pass                                                | jsdom axe (contrast off); Chromium axe for the default pair |
| Density and overflow at 1440x900 and 390x844              | Pass — the row wraps; no horizontal overflow                                                                                        | Pass                                                | Browser, both columns                                       |

Reorder, sort, filter, select and resize: not applicable to this pair (12 items).

**What the checklist does not settle.** Both sides pass, so the decision is not
carried by it. What separates them is in row 18: the stock item's `<a href>` model
leaves the router, it has no range or count, and it is the legacy kit.

### Automated evidence

| Evidence                                                                 | Result                                   | Command                                                                                 |
| ------------------------------------------------------------------------ | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides             | 18 cases, zero violations (contrast off) | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx` |
| Harness contracts (one scenario object to both columns, frozen fixtures) | pass                                     | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`      |
| The route the copies lived on: range label, and `Previous` on page 1     | pass                                     | `pnpm exec vitest run src/routes/projects/$projectId/experiments.test.tsx`              |

Screenshots (`COMPONENT_COMPARE_SHOTS=<dir>`, or the harness page itself):
`.amp/in/artifacts/harness-paging-a-list-{ours,theirs}.png` from the run that
produced this row — the 5,000-row fixture, where ours reads "Showing 1–25 of 5000
rows · Previous · Next" and theirs shows "Previous · 1 · 2 · 200 · Next".

### Conditions an adoption would carry

None for ours: it replaces the four copies in the same change. A future adoption
of a registry pager would have to be a router-link pager (TanStack `Link`, not
`<a href>`), carry a range label, and be restyled to tokens — that is the bar
this row declined the stock item against.

### Limits of this row

- Desktop Chromium and jsdom only; no Firefox, WebKit or real device.
- The pair fixes the page size at 25 rows and renders the pager alone; the
  screens' footer bars (project tabs) are not in either column.
- The stock column is the repository's existing copy of the item, restyled; a
  fresh `shadcn add pagination` would be a different file.

## Row 18 — Stock shadcn `Pagination*` (declined)

### What we use now

Nothing. `src/components/ui/pagination.tsx` has a story
(`src/stories/Pagination.stories.tsx`) and **zero** call sites in the app, and it
is already half-migrated: it imports `buttonVariants` from the v3 kit. It is the
legacy kit's copy of the stock shadcn item.

### What it offers, and what is materially worse

- **It leaves the router.** `PaginationLink`, `PaginationPrevious` and
  `PaginationNext` all render a plain `<a href>`. A pager here navigates the
  same route at another `?page=`; an anchor full-reloads the screen and drops
  the client router.
- **No range and no count.** The design's footer line is a count — "11 of 17
  files · instrument exports are parsed into datasets" (ProjectFiles canvas) —
  and the four hand-rolled blocks printed "Showing 1–25 of 40 experiments". This
  item prints numbered pages and nothing else.
- **The wrong model.** It is built for numbered pages; these lists are 25-row
  windows on server-paged reads (and 50-row cursor pages elsewhere).
- **Decision 1.** It is the legacy kit, which ADR-0055 decision 1 says is not
  extended. Adopting it would also add the first legacy import to a v3 screen
  and trip `src/components/v3/ui/component-adoption.test.ts`.

### Checklist result

It passes the same 6 items as row 17 (it is keyboard-reachable and it pages), and
that is recorded rather than argued with: the decline is on the four points
above, not on the checklist.

### Decision and reason

**Decline.** `@reui/pagination` does not exist (row 17's 404 body), so there is no
ReUI candidate; the stock shadcn item fails ADR-0055 decision 1 and, on its own
merits, cannot drive this router or print this range. The in-house `Pager` keeps
the link model the screens already had, adds the landmark and the inert ends,
and deletes four copies.

**This ruling is the standing one for a stock shadcn item in the legacy kit**
(`src/components/ui/**`): leaving the router, printing no range or count, and
living in the kit decision 1 does not extend are each sufficient, and the same
three apply to the stock `Breadcrumb*` item at row 21. It is recorded once here
rather than re-argued per component.

### Limits of this row

- The item was compared as the repository's copy, restyled to tokens. Its
  upstream shadcn equivalent may differ; the item that would matter is the one
  the CLI installs, and that is the same file family.
- No browser run for this row's appearance beyond the harness screenshots.

## Row 19 — Growing-window list control (`load-more-control`)

### What we use now

Six hand-rolled controls with five labels between them — `"Loading…"`,
`"Loading more…"`, `"Load more"`, `"Load more (N left)"`, `"Scroll for older
entries"` — and no `nav` landmark on any of them:

- `routes/search.tsx` — a plain button, `Loading…` while fetching;
- `routes/experiments.tsx` — a small quiet button in the list's footer bar;
- `routes/datasets/$datasetId/rows.tsx` — count, note and a `Load more (N left)`
  button in the grid's foot;
- `routes/datasets/$datasetId/compare.tsx` — `Load more (N left)`;
- `components/v3/integrations/enterprise-source-panel.tsx` — a continuation
  token beside "List objects";
- `routes/settings/audit.tsx` — a cursor tail inside the table body whose **idle
  state offered no control at all**: older entries were reachable by scrolling
  and by no keyboard path.

The survivor is `src/components/v3/ui/load-more.tsx`: one `nav` with the screen's
own label, an optional "Showing {loaded} of {total} {noun}" line for the screens
that do not print the count themselves, one button ("Load more" / "Loading…"), a
retry for a failed read, and an optional screen-authored end line.

### What ReUI offers

No item. `GET https://reui.io/r/base-nova/load-more.json` answers
`404 {"error":"Registry item not found"}` and ReUI's index has no load-more
component; the stock shadcn catalogue has none either. There is nothing to
adopt and nothing to compare against, so this row records a consolidation.

### Checklist result

| Check                                                     | Ours                                                        | Theirs (the deleted spellings, kept in the pair)                                       | How it was measured      |
| --------------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------ |
| Tab reaches every control, with a visible focus indicator | Pass                                                        | Pass, except the audit tail's idle state                                               | jsdom axe, both columns  |
| Move forward through the list without a pointer           | Pass — Tab to the control, Enter reads the next page        | Pass in the four button spellings; **fail** on the audit tail (text, not a control)    | Browser, both columns    |
| Empty (0 rows), loading, error, permission-restricted     | Pass — the control disappears when there is nothing to read | Pass, except that the audit tail still says "Scroll for older entries" with no control | jsdom axe, both columns  |
| Dark theme                                                | Pass — token-bound colours only                             | Pass                                                                                   | jsdom axe (contrast off) |
| Density and overflow at 1440x900 and 390x844              | Pass                                                        | Pass                                                                                   | Browser, both columns    |

The count trio is on this pair, so its count line is compared: ours reads
"Showing 4 of 12 changes" once, where the deleted spellings printed the count in
the button and again in a footer bar.

### Automated evidence

| Evidence                                                             | Result                                   | Command                                                                                                          |
| -------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| axe, both columns, every fixture and state                           | 18 cases, zero violations (contrast off) | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`                          |
| Harness contracts                                                    | pass                                     | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`                               |
| The three routes that owned a copy: paging, retry and the audit tail | pass                                     | `pnpm exec vitest run src/routes/datasets/$datasetId/{rows,compare}.test.tsx src/routes/settings/audit.test.tsx` |

### Decision and reason

**Adopt.** One control, one label, one count format, one retry, a landmark that
says what is being extended, and a keyboard path the audit tail lacked. Six
call sites and their five labels are deleted in the same change.

### What is still queued

- **`components/v3/datasets/dataset-history-tab.tsx`** — the sixth v3 load-more
  site — delegates its control to `ObjectHistoryTimeline`, which is the shared
  surface the audit-timeline lane has since landed. It is queued for the next
  tranche and should be a small change against that surface: hand it the
  `LoadMore` contract rather than its own button.
- The three peers outside the v3 surfaces (`components/audit/object-history-timeline.tsx`,
  `components/audit/audit-trail.tsx`, `components/sheet/canonical-sheet-workspace.tsx`)
  are the same call sites once that surface is one control.

### Limits of this row

- The audit log's tail is inside a table body (`<TableRow><TableCell>`), so the
  column renders it as a cell and not as the shipped table row; the control is
  the same.
- The connector panel's continuation token is compared without a count, because
  the panel does not know one.
- The label unification was accepted on review: "Load more" with the remaining
  count as the control's own line, rather than a count inside the button.

## Row 20 — List screen header (`list-header`)

### What we use now

`ListHeader` (`src/components/v3/inventory/list.tsx`) is composed by eight
registry screens (samples, materials, protocols, datasets, templates, pipelines,
models, instruments). Two more composed the same band by hand, with class
strings that matched `ListHeader`'s character for character — including the
`-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0` tab rail:

- `routes/experiments.tsx` — `h1`, count, a primary action that had to wrap at
  400 % zoom (QA4-zoom-experiments, the reason for its own `max-md:flex-wrap`),
  and the URL tab strip;
- `routes/inbox.tsx` — `h1`, a muted subtitle, two actions that measured 408px
  at 390 and pushed "Mark all seen" out of the viewport (WCAG 1.4.10), and a
  roving-focus `role="tablist"`.

### What one component's API had to cover

`ListHeader`'s existing `title`/`total`/`actions`/`tabs` plus one thing the
hand-rolls carried that it did not: **a line beside the title**. The inbox's
subtitle could only go in the `<h1>` otherwise, which would have made the
sentence part of the heading's accessible name. The wrap rule the experiments
header had invented is now the header's own (`flex-wrap` on the row, actions
full-width below `md`), and the unknown-count state is the existing
`total?: number` — omit it and no count renders.

### Checklist result

| Check                                                     | Ours (`ListHeader`)                                                 | Theirs (the two hand-rolls)                                            | How it was measured      |
| --------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------ |
| Tab reaches every control, with a visible focus indicator | Pass — actions, then the tab links                                  | Pass — actions, then the tab buttons                                   | jsdom axe, both columns  |
| Empty, loading, error, permission-restricted              | Pass (harness-owned states)                                         | Pass                                                                   | jsdom axe, both columns  |
| Dark theme                                                | Pass — token-bound colours only                                     | Pass                                                                   | jsdom axe (contrast off) |
| Density and overflow at 1440x900 and 390x844              | Pass — the row wraps and the actions take their own line below `md` | Pass — the inbox header wraps; the experiments header wraps below `md` | Browser, both columns    |

No control class applies (`controls: []`), so the sort/filter/select/reorder/
resize/pagination items are all not applicable.

### Automated evidence

| Evidence                                                     | Result                                                   | Command                                                                                 |
| ------------------------------------------------------------ | -------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| axe, both columns, every fixture and state                   | 18 cases, zero violations (contrast off)                 | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx` |
| The two screens the headers were migrated on                 | pass, including the no-longer-hand-rolled wrap assertion | `pnpm exec vitest run src/routes/experiments.test.tsx src/routes/inbox.test.tsx`        |
| The story: registry, no-count, subtitle and tab-strip states | renders                                                  | `src/stories/ListHeader.stories.tsx`                                                    |

### Decision and reason

**Adopt the migration.** The band, the count format and the wrap rule are the
shared header's; the inbox is not a special case once `ListHeader` can carry a
subtitle. The two hand-rolled headers are deleted in the same change, and the
experiments header's QA4 comment moves to the header that now owns the rule.

### Limits of this row

- The column compares the **inbox** header (the harder of the two: subtitle, two
  actions, roving-focus tablist). The experiments header — count and one
  full-width action — is the same band and is covered by the story, not by the
  pair.
- The tab strips are left as they are: reconciling the six tab and segment
  components is its own task, and this pair does not pre-empt it.

## Row 21 — Page location trail (`breadcrumb-trail`)

### What we use now

24 files composed the crumb line and passed it to `PageHeader crumbs`, 57 times
between them. The trail was markup: a `Link`, a `{' '}`, a hand-spelled `/`, and
an identifier wrapped by hand at each site (`<span className="mono">`). Twelve
route files spelled the separator themselves; none produced `ol`/`li`; none
marked the crumb you are on, so the "you are here" half of a breadcrumb was
missing everywhere. The two help routes hand-rolled their own: `help/records.tsx`
had the `ol`/`li` and `aria-current` (the one place in the app that did), and
`help/shortcuts.tsx` had a text separator and no list at all.

The survivor is `src/components/v3/ui/breadcrumb.tsx`: the trail as data
(`{ label, link?, mono? }[]`), rendered by `PageHeader trail` and used directly by
the two help articles, which keep their own header bands (they are full-bleed
document surfaces; the design canvas gives them `md:px-8`, not the header's
`md:px-6`).

### What ReUI offers

Nothing: ReUI's index has no breadcrumb item, and the stock shadcn
`Breadcrumb*` is the legacy kit's (`src/components/ui/breadcrumb.tsx`, zero call
sites) — declined under the same ruling as row 18. The shape the scan suggested
("change `PageHeader` to take a trail") is what this change does.

### Checklist result

| Check                                                     | Ours                                   | Theirs (the node 24 files passed) | How it was measured      |
| --------------------------------------------------------- | -------------------------------------- | --------------------------------- | ------------------------ |
| Tab reaches every control, with a visible focus indicator | Pass — each linked crumb               | Pass — each linked crumb          | jsdom axe, both columns  |
| Empty, loading, error, permission-restricted              | Pass (harness-owned states)            | Pass                              | jsdom axe, both columns  |
| Dark theme                                                | Pass — token-bound colours only        | Pass                              | jsdom axe (contrast off) |
| Density and overflow at 1440x900 and 390x844              | Pass — one line, `truncate` on the nav | Pass                              | Browser, both columns    |

**Structural difference, which is the point of the row:** ours is
`nav > ol > li` with the separator `aria-hidden` and `aria-current="page"` on the
last unlinked crumb; theirs is a `nav` with a run of fragments, the separator as
content, and no current crumb. jsdom axe reports `landmark-unique` on the
hand-spelled column when two of them sit side by side — a property of the pair,
recorded as such, not a defect of the shipped code.

### Automated evidence

| Evidence                                                   | Result                                                                           | Command                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| axe, both columns, every fixture and state                 | 18 cases, zero violations (contrast off)                                         | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx` |
| The two help routes that hand-rolled a trail               | pass (their browser specs, `tests/visual/help-*.spec.ts`, assert axe on `#main`) | `pnpm exec vitest run src/routes/help.test.tsx`                                         |
| The story: one crumb, section-and-identifier, three levels | renders                                                                          | `src/stories/BreadcrumbTrail.stories.tsx`                                               |

### Decision and reason

**Adopt the in-house `Breadcrumb` and delete the `crumbs` node slot** — 24 files
migrated in the same change, with no parallel way to pass a trail left behind.
The win is the semantics: list structure, a separator the accessibility tree does
not read, and a marked current crumb, on every screen rather than in one help
article.

### Limits of this row

- The pair compares one trail per column. A single-crumb trail (the loading and
  not-found states) is covered by the story, not by the pair.
- Crumb **content** is unchanged: `crumbs="Home"` on `/analysis` still says
  "Home". This row is about how a trail is rendered, not about what each screen
  claims its location is.

## Row 22 — Settle-delay search box (`useSettledValue`, no pair)

### What we use now

Three copies of one debounce, and the second was a verbatim copy of the first
including its comment:

- `src/components/v3/inventory/list.tsx` (`ListToolbar`, 200 ms) — the rule the
  comments describe: hold what was typed, report a settled value, and adopt a
  value that changed somewhere else (a tab, "Clear search") without clobbering
  pending typing;
- `routes/datasets/$datasetId/rows.tsx` (200 ms) — the same code, character for
  character, with `navigate` in place of `onSearch`;
- `routes/settings/audit.tsx` (250 ms) — a different shape (`useSettledSearch`),
  because a server read does not need the two-nature half.

The survivor is `src/lib/settled-value.ts`: `useSettledValue(value, ms,
onSettle?)` returning `{ value, setValue, settled }`, with the `sent` ref and the
cleanup. The two route-navigation sites share `SEARCH_SETTLE_MS` (200 ms); the
audit read keeps 250 ms and says why in its own comment.

### Why there is no pair

A comparison harness compares two rendered columns. Both columns here would be
the same input with the same behaviour — the difference is where 25 lines live,
which a column cannot show. Registering a pair would produce two identical
screenshots and no evidence. The evidence is the hook's suite instead.

### Automated evidence

| Evidence                                                                                                                                                                                  | Result                                               | Command                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Burst reports once; no report on mount; an external change is adopted and the queued keystroke dropped; the echo of its own report is ignored; the settled value is held with no callback | 5 tests, pass                                        | `pnpm exec vitest run src/lib/settled-value.test.ts`                                                   |
| The three call sites: the registry toolbar, the dataset rows grid, the audit log                                                                                                          | pass (their existing suites, unchanged in behaviour) | `pnpm exec vitest run src/routes/settings/audit.test.tsx src/routes/datasets/$datasetId/rows.test.tsx` |

### Decision and reason

**Adopt the shared hook; delete the three copies.** The behaviour is the part
worth keeping — the `sent` ref and the cleanup are what stop a settled report
clobbering typing that is still pending — and it was the part copied by hand.

### Limits of this row

- No browser evidence: the debounce is covered in jsdom with fake timers, and the
  routes that use it are covered by their own suites.
- `settled` and `onSettle` are both offered because the three call sites needed
  different halves of the same mechanism; a fourth site should use whichever it
  needs rather than adding a third shape.

## Adding a row

Register the pair in `src/components/component-compare/pairs/index.ts` with its
job and its control classes, run the two vitest suites and the browser spec, then
add the pair's row above and its detail section with: what we use now, what the
candidate offers, the per-item checklist result for both sides, the automated
evidence with its commands, the conditions an adoption would carry, the decision
and the reason, and the limits. `docs/development/component-compare.md` has the
step-by-step.
