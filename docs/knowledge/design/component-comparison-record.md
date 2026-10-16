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

| #   | Component (generic UI job)                                                                   | What we use now                                                                                                                                                                                                                                                       | What ReUI offers                                                                                                                                                              | Checklist result                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Decision                                                                                                                                                                                                                   | Measured    |
| --- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Reorderable list — reorder rows by pointer and keyboard                                      | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row)                                                                                     | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx`                                                                                    | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 8 items are not applicable — this pair has no sort, filter, select, resize or pagination control                                                                                                                                                                                                                                                                                         | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface                                                                                                           | 16 Oct 2026 |
| 1a  | The same job, adopted — the notebook's integration of the item against the item as published | `src/components/notebook/notebook-block-reorder.tsx` rebuilt on `@reui/sortable`: `NotebookBlockList`, `NotebookBlockRow`, `NotebookBlockHandle`, with the notebook's own row frame                                                                                   | The registry item as published, with the C1 semantics fix-up — the reference column of the same pair                                                                          | Ours: all 10 pass, including pointer reordering at 390x844, which the adoption was decided on and which the phone-width case now asserts by performing a drag. Theirs: all 10 pass. 8 items not applicable, as above                                                                                                                                                                                                                                                                                                                                                                                       | **Adopted** (workstream B2). C1 resolved in the shipped markup; C2 still open (a real device); C3 and C4 discharged as described below                                                                                     | 16 Oct 2026 |
| 2   | Step progress row — an ordered flow's current stage                                          | `src/components/v3/ui/stepper.tsx` (67 lines), the forward kit's row and the import flow's only step chrome (`import-flow.tsx:334`, `:854`). After this change it is the only stepper in `src`; the legacy duplicate `src/components/ui/stepper.tsx` was deleted here | `@reui/stepper` (base-nova pin), a wizard-navigation primitive: `src/components/reui/stepper.tsx` (494 lines) — a `<nav>` of `<div>` items holding a `role="tablist"` of tabs | Ours: all 8 applicable items pass — display-only, `aria-current="step"`, axe clean, fits 390x844 by wrapping. Theirs: **could not be measured as an adoptable column and was not registered as a pair.** It cannot render the shipped contract (no list named "Steps", no listitem, no `aria-current`), and it fails the harness's own axe gate: 3 critical violations as published, 2 of them still there with the consumer's container fixes. It also fails 390x844 (the row overflows and labels truncate). 8 items are not applicable — no reorder, sort, filter, select, resize or pagination control | **Decline — do not adopt.** The item is a different job (wizard navigation, not a progress row) and clearing the bar means rewriting the tags, roles and attributes it declares, which ADR-0055 decision 2 does not permit | 16 Oct 2026 |

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
- **C2 — verify touch on a device. Still open.** The grip is rendered at every
  width and is visible where no hover exists, the pointer path is measured at
  390x844, and the touch sensor activates under synthetic touch. None of that is
  a real touchscreen, so a device pass remains oustanding — but it is no longer
  blocking the deletion of the hand-rolled implementation, which row 1's
  condition is about, because nothing of that implementation is left.
- **C3 — accept the dependencies. Discharged.** `@dnd-kit/core`,
  `@dnd-kit/sortable` and `@dnd-kit/utilities` are the versions the shadcn CLI
  chose when the item was installed (`6.3.1`, `10.0.0`, `3.2.2`) and they were
  already in the lockfile from row 1's change. What replaces the 240 lines is
  one copy-and-own file plus the three notebook components that bind it.
- **C4 — the drop preview. Partly discharged, on the record.** The insertion
  line is gone: the drop is shown by the dragged row's own dimming and by the
  rows around it shifting, not by a floating clone. That is a smaller change than
  row 1 anticipated, and it is deliberate — the item's overlay clones the row it
  is dragging, which here would mount a second editor. The notebook's
  design-set row and parity expectation still need the visual change recorded
  against them, which this change does not do.
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

## Adding a row

Register the pair in `src/components/component-compare/pairs/index.ts` with its
job and its control classes, run the two vitest suites and the browser spec, then
add the pair's row above and its detail section with: what we use now, what the
candidate offers, the per-item checklist result for both sides, the automated
evidence with its commands, the conditions an adoption would carry, the decision
and the reason, and the limits. `docs/development/component-compare.md` has the
step-by-step.
