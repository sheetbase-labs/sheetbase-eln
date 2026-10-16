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

| #   | Component (generic UI job)                                                 | What we use now                                                                                                                                                                                                                                                                                        | What ReUI offers                                                                                                                                                                                                                                                                                                                          | Checklist result                                                                                                                                                                                                                                                                                                                                                                                                                                   | Decision                                                                                                                                                                                                                                                                                                                                                                                       | Measured    |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Reorderable list — reorder rows by pointer and keyboard                    | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row)                                                                                                                      | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx`                                                                                                                                                                                                                                                | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 8 items are not applicable — this pair has no sort, filter, select, resize or pagination control                                                                                                                                 | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface                                                                                                                                                                                                                                                                               | 16 Oct 2026 |
| 2   | List row / row chrome — one row, its link form, and the list that holds it | ≈30 hand-rolled row renderers across 21 domain files; two competing entity rows (`RecordLink`, 92 lines, and `LinkedRecordList`, 47); six families (entity, property, file, comment, check, step), each spelling its own leading slot, truncation, meta line, trailing slot, hover and focus treatment | **Nothing to install.** `@reui/item` and `@reui/row` both return `404 {"error":"Registry item not found", "message":"item is part of shadcn/ui, not a ReUI item"}`. The nearest registry item is stock shadcn's compound `Item`, which is not ReUI-native and has no link form, no read-only state vocabulary, and pulls the `cn` package | Not run against a registry candidate — there is none for this job, so ADR-0055 decision 5's A/B comparison has no second column. The in-house pair's own contract is pinned instead: `src/components/v3/ui/row.test.tsx` (11 tests: the four forms, list semantics, empty, windowing, hover detail), the migrated sites' tests (176 pass), axe with **zero violations** (WCAG 2 A/AA) over the rendered inspector, and the rendered evidence below | **Consolidate in-house: `Row` + `RowList` in the v3 kit, with `DescriptionList` as the property row.** No registry adoption. Reason: every family's cost is the _number of implementations_, not a missing feature, and the rival implementations differ in exactly the ways one component should fix — which registry item to install is a different question, and for this job there is none | 16 Oct 2026 |

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

## Row 2 — List row / row chrome (`row`)

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
  set was re-measured by this change.

## Adding a row

Register the pair in `src/components/component-compare/pairs/index.ts` with its
job and its control classes, run the two vitest suites and the browser spec, then
add the pair's row above and its detail section with: what we use now, what the
candidate offers, the per-item checklist result for both sides, the automated
evidence with its commands, the conditions an adoption would carry, the decision
and the reason, and the limits. `docs/development/component-compare.md` has the
step-by-step.
