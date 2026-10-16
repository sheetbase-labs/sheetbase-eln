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

| #   | Component (generic UI job)                                                                   | What we use now                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | What ReUI offers                                                                                                                                                                                                                                                                                                                                                                                                    | Checklist result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Measured                                                                                                                                                                                                                                                                                                                                                           |
| --- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Reorderable list — reorder rows by pointer and keyboard                                      | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row)                                                                                                                                                                                                                                                                                                           | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx`                                                                                                                                                                                                                                                                                                                          | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 8 items are not applicable — this pair has no sort, filter, select, resize or pagination control                                                                                                                                                                                                                                                                                         | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 16 Oct 2026                                                                                                                                                                                                                                                                                                                                                        |
| 1a  | The same job, adopted — the notebook's integration of the item against the item as published | `src/components/notebook/notebook-block-reorder.tsx` rebuilt on `@reui/sortable`: `NotebookBlockList`, `NotebookBlockRow`, `NotebookBlockHandle`, with the notebook's own row frame                                                                                                                                                                                                                                                                                                         | The registry item as published, with the C1 semantics fix-up — the reference column of the same pair                                                                                                                                                                                                                                                                                                                | Ours: all 10 pass, including pointer reordering at 390x844, which the adoption was decided on and which the phone-width case now asserts by performing a drag. Theirs: all 10 pass. 8 items not applicable, as above                                                                                                                                                                                                                                                                                                                                                                                       | **Adopted** (workstream B2). C1 resolved in the shipped markup; C2 still open (a real device); C3 and C4 discharged as described below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | 16 Oct 2026                                                                                                                                                                                                                                                                                                                                                        |
| 2   | Step progress row — an ordered flow's current stage                                          | `src/components/v3/ui/stepper.tsx` (67 lines), the forward kit's row and the import flow's only step chrome (`import-flow.tsx:334`, `:854`). After this change it is the only stepper in `src`; the legacy duplicate `src/components/ui/stepper.tsx` was deleted here                                                                                                                                                                                                                       | `@reui/stepper` (base-nova pin), a wizard-navigation primitive: `src/components/reui/stepper.tsx` (494 lines) — a `<nav>` of `<div>` items holding a `role="tablist"` of tabs                                                                                                                                                                                                                                       | Ours: all 8 applicable items pass — display-only, `aria-current="step"`, axe clean, fits 390x844 by wrapping. Theirs: **could not be measured as an adoptable column and was not registered as a pair.** It cannot render the shipped contract (no list named "Steps", no listitem, no `aria-current`), and it fails the harness's own axe gate: 3 critical violations as published, 2 of them still there with the consumer's container fixes. It also fails 390x844 (the row overflows and labels truncate). 8 items are not applicable — no reorder, sort, filter, select, resize or pagination control | **Decline — do not adopt.** The item is a different job (wizard navigation, not a progress row) and clearing the bar means rewriting the tags, roles and attributes it declares, which ADR-0055 decision 2 does not permit                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 16 Oct 2026                                                                                                                                                                                                                                                                                                                                                        |
| 4   | List row / row chrome — one row, its link form, and the list that holds it                   | ≈30 hand-rolled row renderers across 21 domain files; two competing entity rows (`RecordLink`, 92 lines, and `LinkedRecordList`, 47); six families (entity, property, file, comment, check, step), each spelling its own leading slot, truncation, meta line, trailing slot, hover and focus treatment                                                                                                                                                                                      | **Nothing to install.** `@reui/item` and `@reui/row` both return `404 {"error":"Registry item not found", "message":"item is part of shadcn/ui, not a ReUI item"}`. The nearest registry item is stock shadcn's compound `Item`, which is not ReUI-native and has no link form, no read-only state vocabulary, and pulls the `cn` package                                                                           | Not run against a registry candidate — there is none for this job, so ADR-0055 decision 5's A/B comparison has no second column. The in-house pair's own contract is pinned instead: `src/components/v3/ui/row.test.tsx` (11 tests: the four forms, list semantics, empty, windowing, hover detail), the migrated sites' tests (176 pass), axe with **zero violations** (WCAG 2 A/AA) over the rendered inspector, and the rendered evidence below                                                                                                                                                         | **Consolidate in-house: `Row` + `RowList` in the v3 kit, with `DescriptionList` as the property row.** No registry adoption. Reason: every family's cost is the _number of implementations_, not a missing feature, and the rival implementations differ in exactly the ways one component should fix — which registry item to install is a different question, and for this job there is none                                                                                                                                                                                                                                                                                                                                               | 16 Oct 2026                                                                                                                                                                                                                                                                                                                                                        |
| 5   | Empty state — explain what is absent and offer one next action                               | The forward kit's 37-line `EmptyState` (`src/components/v3/ui/empty-state.tsx` at `35423ec2`): `icon`, `title`, `body`, and a `children` slot nothing documents as the action slot. 92 product sites use it; 70 are self-closing, and the plan's §11.2 count puts 73 that cannot satisfy `DESIGN.md:383`. The legacy kit's `ui/empty.tsx` (a compound `Empty`/`EmptyIcon`/`EmptyTitle`/`EmptyDescription`/`EmptyActions` family with **zero** product call sites) is the second predecessor | The catalogue lists Empty, but the ReUI registry serves no such item: `https://reui.io/r/base-nova/empty.json` answers **404** — "empty is part of shadcn/ui, not a ReUI item. Install it with: `npx shadcn@latest add empty`". The candidate is therefore the **stock shadcn `empty` item, by bare name** (`ui.shadcn.com/r/styles/new-york-v4/empty.json`): `Empty`, `EmptyHeader`, `EmptyMedia` (`variant="icon" | "default"`), `EmptyTitle`, `EmptyDescription`, `EmptyContent`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Ours: the two applicable behavioural items pass — the action is reachable and works from `children`, and the states hold — but the _product_ fails the rule the item exists to satisfy: 70 of 92 sites close the component with nothing in `children`, and the plan's §11.2 count puts 73 of 92 that cannot satisfy `DESIGN.md:383` (see the detail table). Theirs: all applicable items pass, with three measured costs — the title and description are `<div>`s (no heading, no paragraph), the dashed border draws nothing on its own, and the presentation is centred, which the design system's EmptyState rule contradicts. 10 items are not applicable — this pair has no reorder, sort, filter, select, resize or pagination control | **Adopt in part, in this change**: the item's documented action slot and its title/description/media vocabulary are taken; the compound exports, the `div` semantics and the centred borderless-empty presentation are declined. The single component that results is `src/components/v3/ui/empty-state.tsx`, and both predecessors are deleted in the same change | 16 Oct 2026 |
| 6   | History rows — render a chronological list of audit events as rows                           | Three panels with their own rows: `src/components/audit/audit-trail.tsx` (175 lines), `object-history-timeline.tsx` (308), `record-history-timeline.tsx` (264) — a triplicated loading skeleton, two byte-identical dashed empty states, a local relative-time formatter, four icon maps, two row layouts and two continuation controls between them                                                                                                                                        | `@reui/timeline` (base-nova pin), one file: `src/components/reui/timeline.tsx` — `Timeline`, `TimelineItem`, `TimelineIndicator`, `TimelineSeparator`, `TimelineHeader`, `TimelineDate`, `TimelineTitle`, `TimelineContent`. No states, no controls, no chips, no disclosure                                                                                                                                        | Ours: all 8 applicable items pass — the rows render the fixture with both time labels, the before→after chip, the deep link and the disclosure; axe clean in both themes; no overflow at either width. Theirs: the composition renders, but the item ships no states, no controls and no `<time>` value, so its empty, loading and error cells are the harness's own. 10 items are not applicable — this pair has no reorder, sort, filter, select, resize or pagination control                                                                                                                           | **Adopt, in this change**: the shared surface `src/components/audit/history-timeline.tsx` is built on the item, the three panels map onto it, and the duplicated skeleton, empty state, formatter, icon maps, row layout and continuation control are deleted with it. No parallel implementation is left behind                                                                                                                                                                                                                                                                                                                                                                                                                             | 16 Oct 2026                                                                                                                                                                                                                                                                                                                                                        |

## Row 1 — Reorderable list (`notebook-sortable`)

**This row is the pre-adoption record**: the comparison that decided the
adoption. What the notebook does now, and what the adoption measured, are in
[Row 1a](#row-1a--reorderable-list-adopted-notebook-sortable) below. Nothing in
this section is overwritten — the pair it describes was measured at revision
`35423ec2` of `work/b2-notebook-sortable`, and that revision is where the
hand-rolled implementation, its pair and these numbers still reproduce.

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

## Row 1a — Reorderable list, adopted (`notebook-sortable`)

The same pair, after its candidate was adopted (workstream B2 of
`plans/notebook-editor-and-reui.html`, §11.6). The columns no longer differ in
mechanism; they differ in integration, which is where an adoption's regressions
show up. Our side is the shipped code; the reference side is the registry item
as published with the C1 fix-up, unchanged from row 1.

### What changed

`src/components/notebook/notebook-block-reorder.tsx` was rebuilt on the vendored
item. It holds no drag mechanics — no `dragover` midpoint comparison, no
insertion indicator, no edge auto-scroll — and exports three components plus the
move maths the optimistic writer needs:

- **`NotebookBlockList`** — the vendored `Sortable` bound to the notebook's own
  `onMove(itemId, targetIndex)` contract. `Sortable`'s `onValueChange` is unused:
  the order is the route's canonical `blocks` plus an optimistic override the
  document holds, never the list's local state.
- **`NotebookBlockRow`** — the item wearing the notebook's row semantics: a
  labelled `role="group"` with its own tab stop and its own `aria-label`, instead
  of the item's `role="button"` and `tabindex` — C1's resolution, now in the
  shipped markup rather than in a column adapter.
- **`NotebookBlockHandle`** — the item's own handle rendered as a real
  `<button>`, which is what makes its keyboard sensor reachable at all.

Three input paths land in that one callback: pointer and touch through the
item's sensors on the grip; the item's keyboard sensor on the grip (Enter or
Space lifts, arrows move, Enter or Space drops, announced through its live
region); and the notebook's own Alt+↑/↓ and block-menu moves, which share the
same optimistic writer the drop uses. `NotebookBlock` gained a `handle` slot so
the frame can render a caller's grip while keeping its built-in one for the
design gallery and the stories.

Two integration decisions to read before changing any of it:

- **The rows are our own components, not bare `SortableItem`s**, so the item's
  clone-the-active-child overlay does not apply. The clone would mount a second
  block editor inside its portal, and for a sheet block a second canonical sheet
  grid. The drag reads through the item's own dimming and the movement
  transforms on the rows around it. The reference column keeps raw
  `SortableItem` children, which is the difference the two columns now measure.
- **The grip is rendered at every width, and its hover reveal is gated on the
  pointer** (`pointer-fine`) rather than on a width, because a touchscreen
  cannot hover and the grip is its only route to a reorder. Below `lg` the row
  carries the gutter itself (`pl-7 print:pl-0 lg:pl-0`) because the page margin
  there is not wide enough to hold it. Above `lg` the row's box, its padding and
  the grip's box are unchanged from before the adoption.

### Checklist result after adoption

Applicable items are the same 10 as row 1; the other 8 need controls this pair
does not have and stay recorded as not applicable.

| Check                                                     | Ours                                                                                                                                                    | Reference                                                                           | How it was measured                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Tab reaches every control, with a visible focus indicator | Pass — the grip button per row, then each keyboard-reachable row; the row is the item's single drag control                                             | Pass — the handle button per row; the item container is deliberately not a tab stop | Browser, both columns                                                                                        |
| Reorder by keyboard                                       | Pass — Alt+arrow from the focused row, and the item's own lift-and-move on the grip, both announced                                                     | Pass — lift with Enter, move with arrows, drop with Enter                           | Browser and jsdom; the lift, its announcement and its cancel are jsdom cases in `notebook-document.test.tsx` |
| Reorder by pointer                                        | Pass — drag from the grip past the 10px activation; the rows shift and the drag lands where the pointer left it                                         | Pass — the same gesture, same library                                               | Browser, both columns; both produce the same order for the same drop                                         |
| Empty (0 rows), loading, error, permission-restricted     | Pass (with row 1's caveat: these are states of a whole screen and the harness owns them)                                                                | Pass                                                                                | Browser (both columns) and jsdom                                                                             |
| Dark theme                                                | Pass — token-bound colours only; axe clean in dark                                                                                                      | Pass                                                                                | axe in Chromium with colour contrast on, both columns and both themes                                        |
| Density and overflow at 1440x900                          | Pass — no horizontal overflow, no clipped row, grip visible on hover                                                                                    | Pass                                                                                | Browser, both columns                                                                                        |
| Density and overflow at 390x844                           | **Pass — the grip is rendered, is at least 16px, and a drag from it reorders the list.** This is the gap row 1 recorded and the reason for the adoption | Pass — the same                                                                     | Browser, both columns, asserted per column rather than averaged                                              |

### Automated evidence

| Evidence                                                                                                                                                         | Result                                                                            | Command                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides, plus the 2 C1 pins against the vendored item                                                       | 20 cases, **zero violations** (colour contrast disabled: jsdom cannot measure it) | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`                                   |
| axe in Chromium, colour contrast **on**                                                                                                                          | 4 cases (2 columns × 2 themes), **zero violations**                               | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser --grep axe`                          |
| Harness contracts (one scenario object to both columns, frozen fixtures, keyboard reorder, states)                                                               | 12 tests, pass                                                                    | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`                                        |
| Full browser checklist (keyboard, pointer, states, density, the phone-width drag, 4 screenshots)                                                                 | 18 tests, pass                                                                    | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser`                                     |
| Notebook suites, including the grip's registration, the keyboard sensor's lift and cancel, the print-hide membership and the Alt+arrow/menu destination contract | 54 tests, pass                                                                    | `pnpm exec vitest run src/components/notebook/notebook-document.test.tsx src/components/notebook/notebook-block.test.tsx` |
| The real notebook route: keyboard build, reorder and delete against PostgREST                                                                                    | 2 tests, pass                                                                     | `pnpm exec playwright test tests/browser/note-01-authoring.test.ts --project=browser`                                     |
| Full unit suite                                                                                                                                                  | 4,827 tests, pass                                                                 | `pnpm test`                                                                                                               |

Screenshots (`COMPONENT_COMPARE_SHOTS=<dir>`): `ours-light.png`, `ours-dark.png`,
`theirs-light.png`, `theirs-dark.png` — one per column per theme, on the
long-labels fixture. Appearance is evidence; it is not the verdict.

Measurements taken by hand, because no kept test reaches them, all from the
repository at this revision:

- **Desktop geometry is unchanged.** At 1440x900 the notebook's row box is
  256–1116, its left padding is 0px and the grip's box is 229–247 — the same
  numbers as before the adoption. With a fine pointer present the grip's computed
  `opacity` is 0 until the pointer is over the row, and 1 while it is.
- **Phone width is a real path.** At 390x844 the row is 64–374 with 28px of
  leading padding and the grip sits at 65–83 at `opacity: 1`; the document
  reports no horizontal overflow (`scrollWidth` 390), and the grip is clear of
  the shell's rail.
- **Print drops both.** Under `emulateMedia({ media: 'print' })` the gutter's
  `display` is `none` and the row's left padding is `0px`, so the printed
  document carries neither the grip nor the space it needed. The grip's
  membership of the print-hide set is also a kept jsdom assertion.
- **The touch sensor is wired, and that is not a device test.** A synthetic
  `touchstart` on the grip, a 250 ms hold and a `touchmove` set the row's
  `data-dragging` to `true`, and `touchend` clears it. Synthetic touch in
  Chromium is not a touchscreen; C2 below is what that leaves open.

### Conditions, discharged

- **C1 — where the drag's semantics live. Discharged.** The shipped row is a
  labelled group with its own tab stop and its own `aria-label`, so the grip is
  the single control and axe is clean in both engines (20 jsdom cases, 4
  Chromium cases). Both halves of the original measurement still run against the
  vendored item unchanged.
- **C2 — verify touch on a device. OPEN, and named as such.** No real
  touchscreen has run this. What stands in for it: the grip is rendered at every
  width and is visible wherever no hover exists (`pointer-fine` gates the
  reveal), the pointer path reorders at 390x844 in a browser case, and the touch
  sensor activates under synthetic touch in Chromium. None of that is a device,
  so this condition is not closed — closing it needs one. It no longer blocks,
  as row 1 assumed it would, because there is nothing of the hand-rolled
  implementation left to delete.
- **C3 — accept the dependencies. Discharged.** `@dnd-kit/core`,
  `@dnd-kit/sortable` and `@dnd-kit/utilities` are the versions the shadcn CLI
  chose when the item was installed (`6.3.1`, `10.0.0`, `3.2.2`) and they were
  already in the lockfile from row 1's change. What replaces the 240 lines is
  one copy-and-own file plus the three notebook components that bind it.
- **C4 — the drop preview. Discharged where the design set expects it.** The
  insertion line is gone: the dragged row dims and the rows around it shift,
  rather than a floating clone following the pointer. That is a smaller change
  than row 1 anticipated and it is deliberate — the item's overlay clones the
  row it is dragging, which here would mount a second block editor, and for a
  sheet block a second canonical sheet grid. The notebook's canvases draw no
  authoring affordance at all (no grip, no insertion line, no drop preview), so
  the difference is recorded in the two places the design set owns it rather
  than left in a component: the parity registry's expectation
  (`tests/visual/design-states.ts`, which keeps `Nb*` and `Notebook` pending
  until it is settled) and the adoption strategy's verification rule
  (`docs/knowledge/roadmap-4/DESIGN_ADOPTION.md`, "one difference is known and
  is not yet an exception"). Settling it means re-vendoring the canvases with
  the affordances drawn, or an owner decision recorded against those screens —
  not a silent pass.
- Standing requirements from ADR-0055 decision 4: the old implementation is
  deleted in this change with no parallel mechanism left behind, tokens are
  respected (`pnpm check`'s colour check is clean), and the vendored file's only
  edit remains the `cn` import.

### Decision and reason

**Adopted.** The measured reason row 1 gave — no pointer or touch route to a
reorder below 1024px, and a mechanism we maintain ourselves — is closed by
measurement rather than by claim: the phone-width case now performs a drag on
our column and asserts the order changed, where it previously asserted that the
grip was not rendered.

### Limits of this row

- Desktop Chromium (Playwright, one worker) only; no Firefox, WebKit, or real
  device. C2 stands.
- The two columns are no longer two mechanisms. This row measures the adoption's
  integration; it is not a second verdict on `@dnd-kit`.
- The 5,000-row fixture is measured for rendering and overflow, not by axe, as in
  row 1.
- The grip's glyph is the repository's `move` icon, as it was before the
  adoption. At 14px it reads as a small square rather than as a grip, and the
  icon set has no grip or drag icon; that is a discoverability question for the
  touch path, recorded here rather than fixed in a swap.

## Row 2 — Step progress row (`import-stepper`)

### The step chrome in `src`, as found (2026-10-16)

The proposal counted eight distinct step-chrome renderers (`plans/notebook-editor-and-reui.html` §11.2). Eight stateful stage renderers is what this change found; exactly **two of them are the same job**, and those two are the ones consolidated here.

| #   | Renderer                | Where                                                                                                                            | What marks the stage                                                                                    | Same job as the row?                             |
| --- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| 1   | `Stepper` (forward kit) | `src/components/v3/ui/stepper.tsx`; import flow `:334`, `:854`                                                                   | `aria-current="step"`, tick on done steps, reserved `failed` marker                                     | **Yes — the survivor**                           |
| 2   | `Stepper` (legacy kit)  | `src/components/ui/stepper.tsx`; a story only                                                                                    | `data-state` (`done`/`now`/`todo`/`bad`); no `aria-current`                                             | **Yes — deleted by this change**                 |
| 3   | `ApprovalStepper`       | `src/components/audit/approval-stepper.tsx`; review workspace, `/foundations`                                                    | per-step review state (pending, active, completed, rejected, returned, unavailable) with actor and time | No — an approval workflow, not a flow's progress |
| 4   | `GuidePanel`            | `src/components/assist/guide-panel.tsx`; analysis-to-figure and submission-readiness guides                                      | per-step Done / Current / Blocked, with blocked reasons and next-action buttons                         | No — a guidance panel                            |
| 5   | Protocol progress list  | `src/components/overview/overview-view.tsx:245-307`                                                                              | per-step `Status` Done / Not started; no current step                                                   | No — procedure progress in an inspector          |
| 6   | Agent workflow steps    | `src/components/v3/pipelines/agents/agent-surface.tsx:480` (a `current_step / steps` cell) and `:561` (the Steps inspector list) | step records with status, and a numeric progress cell                                                   | No — agent-run detail                            |
| 7   | First-run checklist     | `src/routes/index.tsx:630-679`                                                                                                   | numbered circle, tick when done, "N of M done"; no current step                                         | No — an onboarding checklist, order-free         |
| 8   | Review walkthrough      | `src/components/review/revision-diff-review.tsx:166`, `:265`                                                                     | `aria-current="step"` on the change being walked                                                        | No — walking a change list                       |

Two near-misses were checked and are not step chrome at all: the help centre's how-to list (`src/routes/help/index.tsx:203`, `Step {i + 1}` over `list-decimal`, no state) and the pipeline's code-step list (`src/components/v3/pipelines/pipeline-code.tsx`, `PipelineSteps`) — a guide's numbered list and a pipeline's code steps, as §11.4 predicted. The run log list (`runs/$runId.tsx:314`) and the "Step {step_id}" caption on a paused prompt (`run-prompt.tsx:255`) are likewise not.

So the consolidation is two implementations to one, not eight to one. Renderers 3–8 are different jobs, and this change leaves them alone.

### What we use now

`src/components/v3/ui/stepper.tsx` (67 lines): `<ol aria-label="Steps">` with one `<li>` per step, `aria-current="step"` on the current one, a tick on the steps behind it, and `!` on the current step when its `failed` prop is set. Display-only — no focusable element, no interaction. Its only product surface is the import flow (`src/components/import/import-flow.tsx:334`, `:854`), and `tests/browser/import-flow.test.ts:185-193` is its shipped contract. Story: `UI/Stepper` (`src/stories/Stepper.stories.tsx`).

The legacy kit's `src/components/ui/stepper.tsx` was the same row with the same state derivation and no accessibility contract: `data-state` only, no accessible name for the list, no `aria-current`, no `label`, `text-caption`/`text-muted-foreground` where the v3 row is on the app-3 tokens. Its only consumer was a story. Deleted in this change, with the story repointed at the survivor, the legacy barrel export removed, the legacy README mapping row re-pointed at `v3/ui/stepper.tsx`, and its two unit cases replaced by `src/components/v3/ui/stepper.test.tsx` — which pins the shipped contract and the `failed` marker that no browser test asserts positively.

### What ReUI offers

`src/components/reui/stepper.tsx` (494 lines): `@reui/stepper` installed from the pinned base-nova registry with the shadcn CLI in a scratch directory and placed by hand at the path the item's own `files[].target` names, with the two permitted edits — the `cn` import re-pointed to `#/lib/utils`, and the classes restyled to the app-3 vocabulary (`bg-surface`, `text-fg-muted`, `bg-accent-strong`, `text-on-accent`, `bg-border-strong`, `outline-focus`, `text-label`). No dependency was added: `@base-ui/react` is already the kit's base and `cn` is never installed.

It is a wizard-navigation primitive. `Stepper` renders `<div role="tablist">`, `StepperNav` a `<nav>`, `StepperItem` a `<div>`, and `StepperTrigger` a `<button role="tab">` with `aria-selected`, a roving tabindex and `aria-controls="stepper-panel-N"`; `StepperIndicator`, `StepperTitle`, `StepperDescription`, `StepperSeparator`, `StepperPanel` and `StepperContent` complete it. Its states are `active` / `completed` / `inactive` (and a `loading` flag); there is no failed step. Story: `ReUI/Stepper` (`src/components/reui/stepper.stories.tsx`).

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. The 8 items that apply to a step row are below; the 8 that need reorder, sort, filter, select, resize or pagination controls are not applicable to this job and are recorded as such, not skipped.

| Check                                                     | Ours                                                                                                                                     | Theirs                                                                                                                                             | How it was measured                                                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Tab reaches every control, with a visible focus indicator | Pass, vacuously — the row is display-only and holds no focusable element, so Tab passes over it in DOM order                             | One tab stop: the current step's trigger (roving tabindex `0`; the others `-1`), ring on the `outline-focus` token                                 | jsdom structure (S1 pin); not run in a browser for the candidate — see the limits                                  |
| Empty (0 steps), loading, error, permission-restricted    | Pass — the row itself has none of those states (the flow's `STEPS` is a constant); with `restricted` there is nothing to disable         | Pass on containment; `restricted` is the pair's difference — its steps stay interactive unless the consumer disables every item                    | jsdom (S1 pin) and the code read                                                                                   |
| Dark theme                                                | Pass — axe with colour contrast **on** reports zero violations and zero incomplete on the shipped row in the running app, in both themes | **Not run** — the candidate is not a registered pair                                                                                               | Ours: axe injected into the dev server on `/import`, colour contrast enabled, dark and light; theirs: not measured |
| Density at 1440x900                                       | Pass — no overflow                                                                                                                       | Pass — no page overflow at 1200 in the story                                                                                                       | Storybook capture at 1200x260                                                                                      |
| Density at 390x844                                        | Pass — the row fits by wrapping labels                                                                                                   | **Fail** — the row overflows its container and labels truncate; the consumer has to allow the trigger to shrink (`min-w-0`) and truncate the title | Storybook captures of both stories at 390x260, and the measured overflow (`ol.scrollWidth - clientWidth`)          |

The row's remaining checklist lines are answered by measurements the harness cannot host — the contract run and axe — and are under "Automated evidence" below.

### Automated evidence

| Evidence                                                                                                                                       | Result                                                                                                                                             | Command                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| axe, both sides, on the flow's own three steps with the second current (S1)                                                                    | Ours **zero violations**; theirs as published **3 critical violations**: `aria-required-children`, `aria-required-parent`, `aria-valid-attr-value` | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`   |
| axe, the candidate with the consumer's own container fixes (`role="none"` on the item wrappers, the panel targets its `aria-controls` expects) | `aria-valid-attr-value` cleared; the two structural violations remain                                                                              | same file, third S1 case                                                                  |
| The candidate cannot render the shipped contract                                                                                               | No `list` named "Steps", no `listitem`, no `aria-current="step"` (S1, case 1)                                                                      | same file                                                                                 |
| The shipped contract, ours, end to end                                                                                                         | Pass — 3 steps, names, `aria-current` on the current one                                                                                           | `pnpm exec playwright test tests/browser/import-flow.test.ts --project=browser`           |
| The same spec with the candidate composed in the import flow (the adoption attempt)                                                            | **Fails at the first assertion**: `getByRole('list', { name: 'Steps' }).getByRole('listitem')` resolved to 0 elements, expected 3                  | same command, run 16 Oct 2026 and then reverted; the structural half is pinned by S1      |
| The survivor's contract and its `failed` marker                                                                                                | 4 tests pass                                                                                                                                       | `pnpm exec vitest run src/components/v3/ui/stepper.test.tsx`                              |
| axe, the shipped row in the running app, colour contrast **on**                                                                                | Zero violations and zero incomplete on `/import` in **both** themes (dark and light)                                                               | axe injected into the dev server at 1280x800; the dark capture is `import-steps-dark.png` |

### Why this row is not a registered harness pair

`docs/development/component-compare.md` is explicit that a column which cannot pass axe is not adoptable and that a violation fails the harness's own a11y suite with no allow-list. The candidate cannot pass that gate in any composition a consumer could ship for a progress row — two of the three critical violations are structural to the item, and the third needs placeholder elements for a panel id nothing renders. Registering it would either leave `pnpm test` red or require the harness to tolerate violations, which the runbook forbids. Its measurements are therefore pinned in the harness suite itself (S1 in `component-compare.a11y.test.tsx`), where both sides are rendered on the same steps and compared, and the pair is not in `pairs/index.ts`.

### Decision and reason

**Decline. `@reui/stepper` does not replace the step chrome, and the two in-house steppers are consolidated to one instead.** Four reasons, in the order they decide it:

1. **The shipped contract cannot be met.** `tests/browser/import-flow.test.ts:185-193` requires `<ol aria-label="Steps">`, one `<li>` per step and `aria-current="step"` on the current one. The item renders a `<nav>` of `<div>`s holding a `role="tablist"` of tabs, with no `aria-current` anywhere: measured structurally (S1, case 1) and end to end, where the spec fails at its first assertion with 0 listitems against 3 expected. Producing the contract would mean rewriting the element tags, roles and attributes the copied item declares — which ADR-0055 decision 2 does not permit beyond import-path fixes and restyling.
2. **It fails the harness's own axe gate.** Three critical violations as published, two of them still present after the consumer's own container fixes. An adoption would have to strip the semantics the item declares rather than restyle them.
3. **It is a different job, not a better one.** The item is wizard navigation — steps that change the active step, a roving tab stop, panels it expects to control — where the flow needs a display-only progress row, and its state union has no failed step for the marker the flow reserves. The attempt had to invent that marker; the item cannot mark it.
4. **ADR-0055 decision 4's bar is "materially better, not merely different".** The candidate is ~490 lines to own where the repository owns 67, and what it adds over our row (jumping between steps, a loading indicator, a vertical orientation) is behaviour the import flow does not want.

The one place it does measure better — labels truncate where ours wrap, so a narrow row could be made tidier with consumer work — is not a missing behaviour in our row, and it comes with the checkout of everything above.

If a future surface genuinely needs a navigable wizard (steps as controls, panels per step), this item is the right shape for _that_ screen, and this row should be re-measured rather than inherited: the decline is about this job, not about the registry.

### Limits of this row

- The candidate was measured on its own composition (jsdom axe, structure, and one end-to-end contract run in the import flow). It is not a registered pair, so the browser checklist — screenshots per column per theme, keyboard focus, the four states, dark-theme contrast — was not run for it. The items marked "not run" above are ones the decision did not turn on.
- Appearance evidence comes from Storybook at 1200x260 and 390x260 rather than the harness; appearance is evidence, not the verdict.
- The 5,000-step case was not measured. The item registers every trigger through a state-setting effect and scans its node list per trigger, so its cost grows faster than the step count — a code read, not a measurement; the fixtures' bulk case applies to registered pairs and this one is not.
- Desktop Chromium (Storybook and Playwright) only; no Firefox, WebKit or real device.
- The candidate's restyle was verified visually in Storybook in light theme only; our row was captured in the app in dark and light.

## Row 4 — List row / row chrome (`row`)

### What we use now

≈30 row renderers across 21 files in the domain components, in six families
(entity/linked record, property/metadata, file, comment, check/readiness, event
and step) — the count and the paths are in
[`reui-opportunity-scan-domain.md`](reui-opportunity-scan-domain.md) §JH-1. The
two closest implementations were duplicates of each other: `RecordLink`
(`scientific/record-link.tsx`, 92 lines) carried five honest read-only states
that `LinkedRecordList` (`record/inspector-sections.tsx`, 47 lines) could not
express; each spelled its own leading slot, truncation, meta line, trailing
slot, hover, focus ring and link-vs-static branch.

Migration detail, the settled API and every remaining site are in
[`row-chrome-migration.md`](row-chrome-migration.md).

### What ReUI offers

**Nothing to install.** The pinned registry answers directly:

```
$ curl -sL https://reui.io/r/base-nova/item.json
404 {"error":"Registry item not found","message":"item is part of shadcn/ui, not a ReUI item. Install it with: npx shadcn@latest add item"}

$ curl -sL https://reui.io/r/base-nova/row.json
404 {"error":"Registry item not found","message":"This is not a ReUI registry item. …"}
```

The nearest item on the same index is stock shadcn's compound `Item`
(`Item`, `ItemMedia`, `ItemContent`, `ItemTitle`, `ItemActions`, …). It is not a
ReUI item, and it is a frame with slots only: no link form, no read-only state,
no list semantics, and it imports `cn` from the `cn` package rather than
`#/lib/utils`. The scan's §JH-1 sits in "in-house jobs to componentise (no ReUI
item, or our twin already exists)" for this reason.

### Checklist result

There is no candidate column, so the harness's fixed checklist was not run —
this is a recorded absence of a second column, not a skipped check. What was
measured instead:

| Evidence                                                                                                               | Result                                                                                                     | Command                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Primitive contract (four forms, list semantics, empty slot, windowing, hover detail)                                   | 11 tests, pass                                                                                             | `pnpm exec vitest run src/components/v3/ui/row.test.tsx`                                               |
| Migrated sites' unit tests (inspector, relationships, lineage, related work, notifications, offline, foundations a11y) | 176 tests, pass                                                                                            | `pnpm exec vitest run src/components/{record,knowledge,related-work,collaboration,offline,scientific}` |
| axe, WCAG 2 A/AA, on the rendered inspector (Related work, Relationships, Lineage, Files rows)                         | **zero violations**                                                                                        | Playwright + `axe-core` against the dev server, `/records/…/notebook`                                  |
| Keyboard focus                                                                                                         | the row is a single tab stop with a 2px visible outline                                                    | same run: `outline: 2px solid …` on the focused row                                                    |
| Pointer hover (desktop context, `(hover: hover)` true)                                                                 | the hover fill applies and the going-somewhere arrow appears at 0 → 1 opacity                              | same run: `getComputedStyle(arrow).opacity` 0 → 1, plus the clip                                       |
| Appearance, light and dark, 1440×900                                                                                   | rows render as designed: compact rows in the inspector lists, cards where a card is warranted, no clipping | screenshots in the change's artifacts                                                                  |

### Decision and reason

**Consolidate in-house — `Row` + `RowList` in `src/components/v3/ui/row.tsx`,
with `DescriptionList` as the property row. No registry adoption, and no harness
pair, because there is no registry item for this job to compare against.**

The reason is about what the duplication actually costs. Every one of the ≈30
renderers exists and works; what is wrong is that there are ≈30 of them, and
that the twin implementations differ in exactly the ways a single component
should settle — one can express a read-only state and the other cannot, one
truncates and the other wraps, one shows a hover affordance and the other does
not. A registry install would add a thirty-first frame to a repository that
needs one, and the family's own verdict (the entity row that already exists
becoming the single implementation, plus a property row and a list wrapper) is
cheaper than any of them.

Two requirements from ADR-0055 decision 4 still bind the change that migrates a
site: the old implementation is deleted in the same change (the twin
`LinkedRecordList` was deleted with its call sites updated, not deprecated), and
the substituted surface passes the colour check, axe and the adoption guard.

The third primitive, the property row, stays with `DescriptionList` and needs
`stacked`, an inline split alignment and a per-item `mono` option before
`scientific/property-list.tsx`, `scientific-record-summary.tsx` and
`notebook/notebook-inspector.tsx` can converge on it. That extension is §JH-2's
work and is recorded, not built, in the migration map.

### Limits of this row

- No harness pair exists for row chrome, so the comparison checklist has no
  second column and none of its items were answered by a run. This row is the
  in-house consolidation's decision and its evidence, which is what a
  no-registry-item job can carry.
- axe, hover and focus were measured on one rendered inspector surface (a seeded
  experiment's notebook inspector) in Chromium; the offline list and the
  notification popover were verified by unit test and story, not on live data
  (the seeded workspace has no unread notifications and no pending offline
  edits).
- The compact `list` density is borderless, so a migrated bordered row changes
  appearance. Each migration records that, and no screen in the design parity
  set was re-measured by this change. The parity rows that cover the inspector
  (`RecordDetail-light`/`-dark`, mapped and already at cause 3; `Notebook-light`/`-dark`,
  pending) are named with the evidence and the debt in
  [`row-chrome-migration.md`](row-chrome-migration.md) §Design-set impact; none
  were re-rendered, because the board is red by construction.

## Row 5 — Empty state (`empty-state`)

### What we use now

Two components existed, and this change deletes both.

`src/components/v3/ui/empty-state.tsx` at `35423ec2` was 37 lines: an optional
`icon` (20px, `text-fg-muted`), a required `title` in an `h2.text-section`, an
optional `body` paragraph, and a `children` row. It is the forward kit's
component and 92 product sites render it. Two facts about it decide this row:

- **70 of the 92 sites are self-closing**, and 67 of those have no action at
  all. `children` is the only place an action _can_ go and nothing documents it
  as the action slot, so a screen that writes
  `<EmptyState title … body … />` cannot offer a next step.
  `DESIGN.md` §Application states asks for one: "Empty states explain what is
  absent and offer one relevant next action."
- **22 sites are not self-closing**, and the plan's count puts 19 of the 92 as
  offering an action through `children` — the same slot under an undocumented
  name. The two spellings are what the consolidation removes.

`src/components/ui/empty.tsx` is the legacy kit's compound family — `Empty`,
`EmptyIcon`, `EmptyTitle`, `EmptyDescription`, `EmptyActions` — with **zero**
product call sites: only a story used it. It is deleted with its barrel export.

### What ReUI offers

Nothing, as an item. The catalogue index lists Empty
(`reui.io/components/empty`, "empty state components for zero-data screens"),
but the registry behind the pinned alias does not serve it:

```text
$ curl -sSL https://reui.io/r/base-nova/empty.json
404 {"error":"Registry item not found","message":"empty is part of shadcn/ui,
not a ReUI item. Install it with: npx shadcn@latest add empty"}
```

The item's own page shows the same command, `npx shadcn@latest add empty`. The
candidate is therefore the **stock shadcn `empty` item, installed by bare name**
under the configured `new-york-v4` style, which is what the harness's second
column renders — restyled to the app-3 token vocabulary
(`src/styles.css:683-707`) because an adoption means restyling anyway, and
otherwise unchanged:

| Part               | What it is                                                                                                      | Restyle the app-3 vocabulary forces                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Empty`            | `flex flex-col items-center justify-center gap-6 rounded-lg border-dashed p-6 text-center text-balance md:p-12` | `border-dashed` keeps drawing nothing: Tailwind v4 sets border _style_ with no width, so the published item has no visible outline |
| `EmptyHeader`      | `max-w-sm` centred column, `gap-2`                                                                              | —                                                                                                                                  |
| `EmptyMedia`       | `variant="default"` transparent, or `variant="icon"`: `size-10 rounded-lg bg-muted`                             | `bg-muted` → `bg-surface-muted`, `text-foreground` → `text-fg`                                                                     |
| `EmptyTitle`       | a **`div`**, `text-lg font-medium`                                                                              | `text-lg` → `text-section`                                                                                                         |
| `EmptyDescription` | a **`div`**, `text-sm/relaxed text-muted-foreground`                                                            | `text-sm` → `text-body`, `text-muted-foreground` → `text-fg-muted`                                                                 |
| `EmptyContent`     | the action/content slot: full-width column, `gap-4`                                                             | —                                                                                                                                  |

`EmptyContent` is the part the product does not have, and it is the part the
rule needs: an action slot that is part of the component's contract rather than
a `children` slot that happens to hold a button.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. Ten of its 18
items need reorder, sort, filter, select, resize or pagination controls and are
recorded as not applicable; the eight that apply are below.

| Check                                                           | Ours                                                                                                                                 | Theirs         | How it was measured                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator       | Pass — the action is the only control and it takes focus with the kit's ring                                                         | Pass — same    | Browser, both columns (`the next action is reachable by keyboard and clears the filter`) |
| Empty (0 rows), loading, error and permission-restricted states | Pass — each column renders its own copy for the state; the 0-row fixture is the nothing-yet case, `restricted` is the no-access case | Pass           | jsdom axe over 6 fixtures × 3 states per column; browser run on `long-labels`            |
| Dark theme                                                      | Pass — token-bound colours only                                                                                                      | Pass           | axe in Chromium with colour contrast on, both columns, both themes                       |
| Density and overflow at 1440x900 and 390x844                    | Pass — the 200-character scientific name wraps; the action stays on screen and ≥20px tall                                            | Pass           | Browser, both columns, asserted per column                                               |
| Reorder by keyboard / pointer                                   | Not applicable                                                                                                                       | Not applicable | —                                                                                        |
| Sort / filter / select, by keyboard or pointer                  | Not applicable                                                                                                                       | Not applicable | —                                                                                        |
| Resize / pagination                                             | Not applicable                                                                                                                       | Not applicable | —                                                                                        |

The two columns render the same scenario and the same copy, derived from the
fixture's own hostile content: the `long-labels` fixture puts the 200-character
scientific name in the title and its unit in the description. The action is real
in both columns — pressing it clears the "filter" and the empty state becomes
the nothing-yet copy — so the keyboard item is answered by doing it.

### Automated evidence

| Evidence                                                                                                                                                                       | Result                                                                                                                                                     | Command                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides                                                                                                                   | 18 cases for this pair, **zero violations**; the file's 38 tests are these, row 1's 18, and two for C1 (colour contrast disabled: jsdom cannot measure it) | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`            |
| Harness contracts, including this pair's registration                                                                                                                          | 12 tests, pass                                                                                                                                             | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`                 |
| axe in Chromium, colour contrast **on**, both columns, both themes                                                                                                             | 4 cases, **zero violations**                                                                                                                               | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser --grep empty` |
| Keyboard: Tab to the action, its focus ring, Enter, and the state it claims to change — plus C1 (ours announces the new copy as a heading; the item's `EmptyTitle` is a `div`) | 1 test, pass, both columns                                                                                                                                 | same file                                                                                          |
| Density at 1440x900 and 390x844, with the 200-character name; the action stays visible and ≥20px                                                                               | 2 tests, pass, both columns                                                                                                                                | same file                                                                                          |
| Screenshots (appearance evidence)                                                                                                                                              | `empty-ours-light.png`, `empty-ours-dark.png`, `empty-theirs-light.png`, `empty-theirs-dark.png`, written and inspected                                    | same file, `COMPONENT_COMPARE_SHOTS=<dir>`                                                         |
| The whole spec, both pairs                                                                                                                                                     | 29 tests, pass (18 for row 1, 11 for this pair)                                                                                                            | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser`              |

The `bulk` fixture is not an axe target here for the same reason as row 1 (the
runbook's cost note); for this pair the empty state does not render the rows at
all, so that fixture is only a mount check.

### What an adoption would cost — conditions

- **C1 — decide the semantics deliberately if the item is copied.** Its
  `EmptyTitle` and `EmptyDescription` are `<div>`s. The product's empty states
  are `h2` + `p` today, and a screen's empty state is one of the few headings a
  table-heavy page offers for navigation. Copying the item as published would
  silently remove it; the harness's own 0-row check reads `role=heading`.
- **C2 — restyle to the app-3 vocabulary, not the legacy one.** The item writes
  `bg-muted`, `text-muted-foreground`, `text-sm` and `text-lg`. Those tokens
  still resolve (they are the ELN semantic set, `src/styles.css:336`), so a
  straight copy renders, looks wrong beside its neighbours, and passes the
  colour check — the trap §11.5 of the plan records.
- **C3 — keep the design system's placement.** `Empty` centres its content and
  gives it `min-h-48` and a dashed border. The design system's EmptyState rule
  is "place it where the rows would be, left-aligned with the table, not centred
  in the window" (`docs/knowledge/design/ui-system-v3/design-system/components/EmptyState/README.md`).
  A direct copy contradicts the design set on every list screen.
- **C4 — keep the props the 92 sites use, or migrate them all.** The sites pass
  `icon`, `title` and `body`; the item's compound API has no such props.

### Decision and reason

**Adopt in part, in this change.** The item's one genuinely missing affordance—
a documented action slot — is taken, along with its `title` / `description` /
media vocabulary; the compound exports, the `div` title and description, the
centred dashed-card presentation and the legacy token vocabulary are declined.
The result is the single component `src/components/v3/ui/empty-state.tsx`:
`icon` (or a `media` node), `title`, `description`, `action`, and `children` for
anything after them, with `body` kept as a deprecated alias until the migration
in `docs/knowledge/design/empty-state-migration.md` is finished.

The reason is measured, not preferential. The job the rule names is "say what is
absent and offer one next action", and 70 of the 92 sites render nothing in
`children` and cannot do the second half with the component as it was — the
action slot did not exist (73 by the plan's §11.2 count). The item
supplies that slot. But the item as published is worse on three axes the pair
measures or reads directly: it drops the heading and paragraph semantics the
product's empty states have, it centres and dashes a block the design system
places as a row-aligned notice, and it writes the legacy token vocabulary that
the port exists to leave behind (C1–C3). Adopting it verbatim would therefore
trade one inconsistency (no action) for three.

Both predecessors are deleted in this change, so nothing is left with two
empties: the legacy kit's `ui/empty.tsx` and its barrel export, and the 37-line
implementation this row measures, are gone.

**The change does not run in the reverse direction.** This row is the record of
the comparison; the component it ships is the durable part, and the harness pair
stays registered so the same measurement can be repeated if the item changes.

### Limits of this row

- **The `ours` column renders the implementation this change replaces, not the
  code that ships after it** — the pre-change component is vendored into
  `src/components/component-compare/pairs/empty-state.tsx` because it is deleted
  by the same change. That is the runbook's "our side renders the code that
  ships" rule bent deliberately, and only for this pair: the measured "before"
  is the evidence the decision rests on. The shipped component is
  `#/components/v3/ui/empty-state`.
- The item was read from the live registries on 16 Oct 2026
  (`reui.io/r/base-nova/empty.json` → 404; `ui.shadcn.com/r/styles/new-york-v4/empty.json`
  → the file above). Registry contents change; re-read before re-deciding.
- Desktop Chromium only (Playwright, one worker); no Firefox, WebKit or real
  device was run.
- The restyle of the `theirs` column is the runbook's allowance, so the column
  measures the item's structure and semantics, not its published pixels.
- This row records one pair. It is not a verdict on shadcn as a registry, nor
  on the 88 sites that roll their own empty markup (listed in
  `docs/knowledge/design/empty-state-migration.md`).

## Row 6 — History rows (`history-rows`)

### What we use now

Three panels, each with its own rows:

- `src/components/audit/audit-trail.tsx` (175 lines) — typed `AuditEvent`s. A row
  was an icon dot, the title, an `actor · timestamp · target` line and an sr-only
  sentence; the file also held its own four-row loading skeleton, its own dashed
  empty state, a `typeIcons` map, the `Load more (N left)` button (with a
  chevron) and the `Showing N of M events` line.
- `src/components/audit/object-history-timeline.tsx` (308 lines) — authoritative
  wire change events, correlated by `groupAuditEvents`. A row was an
  actor/action/subject line, the relative and absolute time, before→after
  `ChangeChip`s, `↳` correlated rows, the canonical deep link and the `Raw event`
  disclosure; the file also held its own skeleton (a 3.5px bar where the other
  two used 3px), a dashed empty state byte-identical to the audit trail's,
  `OPERATION_ICONS` and `ENTITY_ICONS`, a load-more button without a count, and a
  dead `showRawOnly` state.
- `src/components/audit/record-history-timeline.tsx` (264 lines) — the
  `api.record_timeline` RPC mapped to `AuditEvent[]` by `mapTimelineEvents` and
  rendered through `AuditTrail`. The file held its own skeleton, its own error
  box with a `Try again` button, its own `relativeTime` formatter, its own
  `OPERATION_ICONS` and `DECISION_ICONS`, and the section heading, Refresh and
  the revision/integrity footer.

Between them: three loading skeletons, two byte-identical dashed empty states
(the third panel rendered none of its own), two relative-time formatters in play
(`formatRelativeTime` from `#/lib/notebook-data` and the local `relativeTime`),
four icon maps, two row layouts and two continuation controls. The behaviour
ADR-0055's bar asks about — the sr-only sentence per event, the relative and
absolute time, the chips, the disclosure, the continuation control, the
permission state and the real `<button>`/`<summary>`/dialog routes — is
unchanged by the consolidation and pinned by the panels' own tests.

### What ReUI offers

`src/components/reui/timeline.tsx` (273 lines, installed from `@reui/timeline`
at the pinned base-nova registry and placed by hand): `Timeline`,
`TimelineItem`, `TimelineIndicator`, `TimelineSeparator`, `TimelineHeader`,
`TimelineDate`, `TimelineTitle`, `TimelineContent`, a context, `useRender` on
every part, `step`/`value`/`defaultValue` semantics and two orientations.

It ships no states, no controls, no chips, no disclosure, no icon well and no
list semantics: by default the parts render `div`s, `TimelineTitle` renders an
`h3`, and `defaultValue = 1` marks the first item completed.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. Applicable
items are the 8 this pair has — it declares no controls, so the 10 items needing
reorder, sort, filter, select, resize or pagination are recorded as not
applicable rather than skipped.

| Check                                                     | Ours                                                                                                                            | Theirs                                                                                        | How it was measured                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass — the deep link and the `Raw event` summary, in DOM order, plus the scroll region (C2), each drawing a visible indicator   | Nothing to reach: the item renders no controls of its own; only the harness's state cells are | Browser, both columns                                                 |
| Empty (0 rows)                                            | Pass — the panel's own dashed `No recorded activity for this object yet.`                                                       | The item ships none; the harness's `No rows` notice stands in                                 | Browser and jsdom, both columns                                       |
| Loading                                                   | Pass — the four-row skeleton, `aria-busy` and `aria-live="polite"`                                                              | The item ships none; the harness's loading rows stand in                                      | Browser and jsdom, both columns                                       |
| Error and permission-restricted                           | Pass — the failure is its own state (`role="alert"`); this column offers **no retry**, because the dataset tab passes none (C1) | The item ships none; the harness's notice and its working retry stand in                      | Browser and jsdom, both columns                                       |
| Dark theme                                                | Pass — token-bound colours only; axe clean in dark                                                                              | Pass                                                                                          | axe in Chromium with colour contrast on, both columns and both themes |
| Density and overflow at 1440x900                          | Pass — no horizontal overflow, no row clipped                                                                                   | Pass                                                                                          | Browser, both columns                                                 |
| Density and overflow at 390x844                           | Pass — same, asserted per column                                                                                                | Pass                                                                                          | Browser, both columns, asserted per column rather than averaged       |

Sort, filter, select, resize, reorder and pagination: not applicable to this pair
(10 items). They are listed in the harness with that verdict.

**The states are not symmetric, and the record says so.** The shared surface
ships its own loading skeleton, empty message and error notice, so this pair's
`ours` column drives the shipped ones; the item ships none, so the empty,
loading and error cells of the `theirs` column are the harness's own notices.
That is a difference between the two columns in what those three items measure,
not a skipped check. `restricted` is different again: neither component has
editing controls, so both render the harness's "View only" notice and the item
measures containment and keyboard order.

### Automated evidence

| Evidence                                                                                                                               | Result                                                                                                                                  | Command                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| axe, both columns of every pair: 6 fixtures × 2 sides + 3 states × 2 sides                                                             | 38 tests, **zero violations** (colour contrast disabled: jsdom cannot measure it)                                                       | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`                                                                                      |
| axe in Chromium, colour contrast **on**, the history pair's two columns in both themes                                                 | 4 cases, zero violations                                                                                                                | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser --grep "history rows pair"`                                                             |
| The pair's full checklist in Chromium: rows and chips, keyboard, the four states, both densities, the 5,000-row fixture, 4 screenshots | 14 tests, pass                                                                                                                          | same command                                                                                                                                                                 |
| The shipped panels' behaviour (sr-only sentence, chips, disclosure, load-more, error states)                                           | 21 tests, pass (`audit-trail` 7, `object-history-timeline` 4, `record-history-timeline` 10)                                             | `pnpm exec vitest run src/components/audit/audit-trail.test.tsx src/components/audit/object-history-timeline.test.tsx src/components/audit/record-history-timeline.test.tsx` |
| The panels on real screens: the dataset History tab and the review screen's History tab                                                | 7 tests, pass (rows, both time labels, chips, link, disclosure, Load more, axe light and dark, the sr-only sentence and the count line) | `pnpm exec playwright test tests/browser/history-timeline.test.ts --project=browser`                                                                                         |
| Harness contracts (one scenario object to both columns, frozen fixtures, the state transitions)                                        | 12 tests, pass                                                                                                                          | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`                                                                                           |
| Whole suite, and the repository's gates                                                                                                | 4,847 tests pass; `pnpm check`, `pnpm lint`, `pnpm typecheck`, `pnpm build` clean                                                       | `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm typecheck`, `pnpm build`                                                                                                       |

Screenshots (`COMPONENT_COMPARE_SHOTS=<dir>`): `history-ours-light.png`,
`history-ours-dark.png`, `history-theirs-light.png`, `history-theirs-dark.png`,
plus `dataset-history-light.png`, `dataset-history-dark.png` and
`review-record-history-light.png` from `HISTORY_SHOTS=<dir>` on the product
screens. Appearance is evidence; it is not the verdict.

### What the adoption cost — conditions

- **C1 — the item ships no states, controls, chips or disclosure.** The shared
  surface owns all of them: the skeleton, the dashed empty state, the `Notice`
  error state and its optional retry, the before→after `ChangeChip`, the
  `Raw event` disclosure, the deep link, the continuation control and the
  "showing N of M" line. An adoption that dropped any of them would lose
  behaviour ADR-0055's bar requires to survive, so they are part of the surface
  rather than of the item. One consequence is visible in this pair: the dataset
  History tab passes no retry, so that column's error state reports the failure
  without offering one; the record-history panel passes the retry the same
  surface supports.
- **C2 — a capped list is a scrollable region, and axe says so.** In Chromium,
  `scrollable-region-focusable` (serious) fires on the list when its rows hold
  no controls of their own — the record-history panel's rows are text only.
  Found by the new product browser test; fixed by making the list a tab stop
  with a focus ring. This adds a tab stop to all three panels, which is a
  deliberate behaviour change rather than a restyle.
- **C3 — contrast on the record-history footer.** The same test found
  `color-contrast` (serious) on the revision/integrity line's
  `text-fg-muted/70`; it is now `text-fg-muted`. Pre-existing, found by the new
  coverage, fixed in the same change.
- **C4 — list and step semantics are the integration's job.** The parts render
  `div`s and `defaultValue = 1` marks the first item completed. The integration
  hands the timeline `<ol>` and each item `<li>` through `render`, and passes
  `value={0}` so no row claims completion. Keeping that is what makes the rows a
  list to a screen reader instead of a stack of divs.
- **C5 — geometry and tokens are restyled, not extended.** The published 1rem
  hollow ring, `border-primary/20`, `bg-primary/10` and the connector's offsets
  are restyled to the app's 2rem indicator well, `border-border`, `bg-border`
  and `accent-strong`. That is all ADR-0055 decision 2 permits in this
  directory, and it is why the `theirs` column shows the app's indicator rather
  than the published one.
- **C6 — the title is not a heading.** `TimelineTitle` defaults to `h3`; the
  rows render it as `<p>`, because the previous rows were not headings and a
  history of 5,000 events should not add 5,000 of them.
- **C7 — the surface renders every row.** There is no virtualisation: the
  5,000-row fixture takes about 1.3 minutes through the dev server, which is why
  that case carries its own 240-second timeout in the browser spec. The panels
  page at 50 rows and continue with "Load more", so a real screen never renders
  the bulk fixture; the cost is recorded because it is the reason the
  continuation control must stay.
- **C8 — dependencies.** `@base-ui/react` is already a dependency and the item's
  `cn` import is re-pointed to `#/lib/utils`, so no package is added
  (ADR-0055's consequences section).

### Decision and reason

**Adopt, in this change.** The three panels now map their own data onto one
shared surface (`src/components/audit/history-timeline.tsx`) built on the item,
and the duplication goes with it: one row layout, one skeleton, one empty state,
one relative-time formatter, one icon vocabulary, one continuation control. The
panels keep their domain mapping — typed audit events, wire change events with
correlation grouping, and the record-timeline RPC — because that is domain work,
not row work.

The reason is ADR-0055 decision 4's second test, the maintenance burden. Three
files carried the same skeleton, the same empty markup and their own row
layouts; two of them carried their own operation-icon map; two of them carried
a relative-time formatter; two carried a continuation control. The item supplies
the composition — indicator, separator, header, date, title, content — and the
step semantics that the hand-rolled rows re-implemented by hand, and it is one
copy-and-own file rather than three.

The three files fall from 747 lines to 440, and the 426-line shared surface
replaces what they duplicated: the row layout, the skeleton, the empty state,
the formatter, the icon vocabulary, the chips, the disclosure, the states and
the continuation control now exist once.

### Limits of this row

- Desktop Chromium only (Playwright, one worker); no Firefox, WebKit or real
  device was run.
- The two columns differ in where their states come from (above), so the empty,
  loading and error rows are not a like-for-like comparison; the shipped states
  are exercised on the product screens instead.
- The 5,000-row fixture is rendered and measured for overflow in both columns,
  not by axe, for the reason the runbook records.
- `src/components/audit/experiment-history.tsx` — the day-grouped table on
  `/experiments/:id/history` — is **not** part of this row. It is not one of the
  three panels, it renders a table with its own inspector rather than timeline
  rows, and its screen is in the design-parity set (`ExpHistory`). The plan's
  inventory counted it among the history surfaces; it remains for a future
  change to consider.
- This row records one pair. It is not a verdict on ReUI as a registry, or on
  any other ReUI item.

## Adding a row

Register the pair in `src/components/component-compare/pairs/index.ts` with its
job and its control classes, run the two vitest suites and the browser spec, then
add the pair's row above and its detail section with: what we use now, what the
candidate offers, the per-item checklist result for both sides, the automated
evidence with its commands, the conditions an adoption would carry, the decision
and the reason, and the limits. `docs/development/component-compare.md` has the
step-by-step.
