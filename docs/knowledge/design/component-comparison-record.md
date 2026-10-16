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

| #   | Component (generic UI job)                                         | What we use now                                                                                                                                                                                                                                                                                                                                      | What ReUI offers                                                                                                                                                                                                                                                             | Checklist result                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Decision                                                                                                                                                                                                                                                                                                         | Measured    |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Reorderable list — reorder rows by pointer and keyboard            | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row)                                                                                                                                                                    | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx`                                                                                                                                                                                   | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 8 items are not applicable — this pair has no sort, filter, select, resize or pagination control                                                                                                                                                               | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface                                                                                                                                                                                                 | 16 Oct 2026 |
| 2   | History rows — render a chronological list of audit events as rows | Three panels with their own rows: `src/components/audit/audit-trail.tsx` (175 lines), `object-history-timeline.tsx` (308), `record-history-timeline.tsx` (264) — a triplicated loading skeleton, two byte-identical dashed empty states, a local relative-time formatter, four icon maps, two row layouts and two continuation controls between them | `@reui/timeline` (base-nova pin), one file: `src/components/reui/timeline.tsx` — `Timeline`, `TimelineItem`, `TimelineIndicator`, `TimelineSeparator`, `TimelineHeader`, `TimelineDate`, `TimelineTitle`, `TimelineContent`. No states, no controls, no chips, no disclosure | Ours: all 8 applicable items pass — the rows render the fixture with both time labels, the before→after chip, the deep link and the disclosure; axe clean in both themes; no overflow at either width. Theirs: the composition renders, but the item ships no states, no controls and no `<time>` value, so its empty, loading and error cells are the harness's own. 10 items are not applicable — this pair has no reorder, sort, filter, select, resize or pagination control | **Adopt, in this change**: the shared surface `src/components/audit/history-timeline.tsx` is built on the item, the three panels map onto it, and the duplicated skeleton, empty state, formatter, icon maps, row layout and continuation control are deleted with it. No parallel implementation is left behind | 16 Oct 2026 |

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

## Row 2 — History rows (`history-rows`)

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
