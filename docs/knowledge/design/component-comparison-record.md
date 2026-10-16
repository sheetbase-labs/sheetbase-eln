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

| #   | Component (generic UI job)                              | What we use now                                                                                                                                                                                                                                                                                   | What ReUI offers                                                                                                                                                                                                                              | Checklist result                                                                                                                                                                                                                                                                                                                                                                | Decision                                                                                                                                                                                                                                                                                                                                                                                                                           | Measured    |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| 1   | Reorderable list — reorder rows by pointer and keyboard | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row)                                                                                                                 | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx`                                                                                                                                                    | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 10 items are not applicable — this pair has no sort, filter, row-select, resize, pagination or option-picker control                                          | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface                                                                                                                                                                                                                                                                                                                   | 16 Oct 2026 |
| 2   | Option picker — choose one option from a grouped list   | v3 `Select` (`src/components/v3/ui/select.tsx`): the **native** `<select>`, styled like `Input`. This change hoists it out of `projects/select.tsx`, makes it the single definition (a second one in `inventory/list.tsx` is deleted), and migrates 22 route sites and 3 further v3 sites onto it | **Stock shadcn `native-select`**, placed by hand at `src/components/reui/native-select.tsx`. **Not a ReUI item**: the pinned ReUI registry serves neither `native-select` nor `select`, so there is no base-nova build of this job to install | Ours: 8 of the 10 applicable items pass, 1 is a measured gap (density at 390: the 44px clause) and 1 is not measurable in either engine (the platform popup's pointer path; see the detail table). Theirs: the same 8, the same gap, the same unmeasurable item. 10 items are not applicable — this pair has no reorder, sort, filter, row-select, resize or pagination control | **Keep ours; no adoption.** The two are the same platform control, so there is no measured decline to weigh: the candidate's own additions (option/optgroup wrappers, `has-[select:disabled]:opacity-50`, a lucide chevron, 36/32px sizes) change nothing behaviourally, and our contract is the better fit — two sizes that grow on mobile, `invalid`, `Field`-awareness, the kit's tokens, no new dependency, and one definition | 16 Oct 2026 |

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

Sort, filter, row-select, resize, pagination and option-picker: not applicable to
this pair (10 items). They are listed in the harness with that verdict and will
be answered when a pair that has those controls is added.

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

## Row 2 — Option picker (`native-select`)

### What we use now

`src/components/v3/ui/select.tsx` — `Select`: the **native** `<select>`, styled
like `Input` and wrapped in a positioning `<span>` that carries a token-coloured
chevron. It is a hoist, not a new build: the primitive existed as
`NativeSelect` in `src/components/v3/projects/select.tsx` (imported by 39
files, including the notebook block editor, the sheet block and the figure
configurator), with a second, differently-shaped definition in
`src/components/v3/inventory/list.tsx:387-404` and raw `<select>` copies in v3
screens and route files. This change makes it one definition in the kit's own
directory, re-points every importer, deletes the second definition, and migrates
the 22 native `<select>` sites in the route surfaces plus three further v3
component sites onto it.

Two facts about it that the measurements turned on:

- **Native is deliberate**, and it is the reason this row compares the native
  item and not a listbox. Keyboard handling, typeahead, `<optgroup>` grouping,
  disabled options, form participation and the platform picker (including the
  OS list on mobile) are the element's; `inventory/list.tsx` recorded the same
  reason before this change ("Native keeps keyboard and screen reader behaviour
  for free"). A JS listbox — the stock shadcn `select`, or `@base-ui/react`'s
  `Select`, whose exports were read for this row — would trade those for
  styling, and would change behaviour on 22 migrated sites that were not
  migrated to gain one.
- **The two sizes are the kit's, not the registry's.** `md` is 30px with
  `max-md:h-10` and `text-body`; `sm` is 26px with `max-md:h-8` and
  `text-label`, mirroring `Button`'s `md`/`sm` mobile growth. `className` merges
  on the wrapper, so a toolbar that is 32px tall (`record-model-records.tsx`)
  passes `size="sm" className="h-8"` and the control follows — no third size.

### What ReUI offers

**Nothing under the ReUI name.** The pinned base-nova registry serves neither
`native-select` nor `select`: both installs fail against
`https://reui.io/r/base-nova/{name}.json` with "item not found" (measured
16 Oct 2026, from a scratch directory with this repository's `components.json`).
The job is served by a **stock shadcn** item, `native-select`, installed by bare
name from the shadcn registry and placed by hand at
`src/components/reui/native-select.tsx` (the runbook's placement rule for
copy-and-own source; `cn` re-pointed to `#/lib/utils`, colours restyled to
Sheetbase tokens because an adoption means restyling anyway).

What that item is: `NativeSelect` plus `NativeSelectOption` and
`NativeSelectOptGroup` wrappers that pin option colours to the OS
`Canvas`/`CanvasText` system colours; a `div` wrapper with
`has-[select:disabled]:opacity-50`; a lucide `ChevronDownIcon`;
`size="default"|"sm"` heights of 36px and 32px with no mobile growth; and
`data-slot`s. Its `select` is the same platform element as ours.

### Checklist result

Fixed checklist: `src/components/component-compare/checklist.ts`. This pair
declares the `picker` control class, added with this row; the other 10 items are
recorded as not applicable rather than skipped.

| Check                                                               | Ours                                                                                                                            | Theirs                                                                                            | How it was measured                                                                             |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator           | Pass — both pickers, reached in DOM order, each drawing the kit's focus outline                                                 | Pass — both pickers, each drawing its ring                                                        | Browser, both columns (`keyboard: reaches every picker by Tab`)                                 |
| Change the option without a pointer (arrow keys, typeahead, groups) | Pass — ArrowDown moves the selection; `R` typeahead crosses into the Standard group; a disabled option is never reached         | Pass — identical, being the same element                                                          | Browser, both columns, asserted per column (`changes the chosen option…`, `typeahead crosses…`) |
| Change the option with the pointer alone                            | **Not measurable** — the popup is the platform's widget, not DOM, so neither engine can drive it                                | **Not measurable** — same platform popup                                                          | Manual; recorded as a limit (see below), not as a pass                                          |
| Empty (0 rows), loading, error, permission-restricted               | Pass — one honest "No rows in this fixture" option, and the control disables in `restricted`                                    | Pass — same, and its own disabled rendering (`opacity-50`)                                        | jsdom (axe, all fixtures and states) and the harness contract test                              |
| Dark theme                                                          | Pass — token-bound colours only; axe clean in dark                                                                              | Pass — axe clean in dark after the token restyle                                                  | axe in Chromium with colour contrast on, both columns, both themes                              |
| Density and overflow at 1440x900                                    | Pass — no page overflow; pickers 30px and 26px, inside the column                                                               | Pass — no page overflow; pickers 36px and 32px                                                    | Browser, both columns, measured per column                                                      |
| Density and overflow at 390x844                                     | **Partial** — no overflow, both pickers inside the column, but 40px and 32px tall: the checklist's 44px touch target is not met | **Partial** — 36px and 32px tall: the same clause unmet, and the item has no mobile growth at all | Browser, both columns, measured (document overflow 0)                                           |

Sort, filter, row-select, resize and pagination: not applicable to this pair (5
of the 10), and the reorder items are not either.

**The 44px clause.** Neither side meets it, and ours is the larger of the two
(40px vs 36px) because `md` grows on narrow screens and the item does not. The
kit's own vocabulary is the constraint: `Button`'s `md` is `max-md:h-10` (40px)
and `Input` does not grow at all (30px), so raising the select alone would make
it taller than the buttons beside it. Recorded here as a kit-wide decision, not
one this change should take alone.

### Automated evidence

| Evidence                                                                                                 | Result                                                                            | Command                                                                                                      |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides, for this pair and the notebook pair        | 18 cases for this pair, **zero violations** (colour contrast off: jsdom)          | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx`                      |
| axe in Chromium, colour contrast **on**, both columns, both themes                                       | 4 cases, **zero violations**                                                      | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser --grep "native select"` |
| Harness contracts (both columns render the same options; the restricted state disables both)             | 14 tests pass (2 of them this pair's)                                             | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`                           |
| Keyboard, density and screenshots in a real engine                                                       | 13 tests pass for this pair                                                       | `pnpm exec playwright test tests/browser/component-compare.test.ts --project=browser --grep "native select"` |
| The migration itself: every `<select>` on the screens walked is the primitive and has an accessible name | 13 selects on 7 of the 14 screens walked, 0 raw, 0 unnamed (measured 16 Oct 2026) | walked with the gareth design user at 1440x900; the screens are listed in the change's report                |

Screenshots (`COMPONENT_COMPARE_SHOTS=<dir>`): `native-select-ours-light.png`,
`native-select-ours-dark.png`, `native-select-theirs-light.png`,
`native-select-theirs-dark.png` — one per column per theme. Appearance is
evidence; it is not the verdict.

### What an adoption would cost

- **There is nothing to pin.** The item is stock shadcn, so an adoption would
  track the shadcn registry rather than this repository's `@reui` pin, and the
  ADR-0055 decision-2 placement rule (`src/components/reui/**`) would be a
  filing convention rather than a registry one.
- **It would restore the duplication this change removes.** The item is a second
  definition of the same control; adopting it means re-pointing 41 files again
  and deleting the hoisted primitive, for no behavioural change.
- **Its sizes and mobile behaviour would have to be re-decided** (36/32px, no
  growth), and its lucide chevron and `div` wrapper would replace the kit's
  `Icon` and `<span>`; the restyle to our tokens is the easy part.
- **Its `NativeSelectOption`/`NativeSelectOptGroup` wrappers** are the one thing
  it has that we do not: option colours pinned to the OS system colours. Nothing
  in the product has needed them; if a dark-mode popup defect ever appears, that
  is the piece to lift, not the whole item.
- **Its focus treatment is a `ring-*`, and it ships `outline-none`.** Restyling
  to our outline means deleting that `outline-none` as well: left in, it cancels
  the outline the restyle adds, and the control then has no visible focus
  indicator at all (measured — the harness's Tab check failed on it until the
  class was removed). A restyle that only swaps colour tokens would ship that.

### Decision and reason

**Keep ours. No adoption.** The bar in ADR-0055 decision 4 is a _materially
worse_ hand-rolled version — a named behaviour missing, or a maintenance burden
that is demonstrably ours. Neither holds here: both sides are the same platform
element, so the behaviour is the same by construction, and this change already
removes the maintenance burden (one definition, 41 importers, 22 migrated sites)
without the registry item. The candidate's own additions are cosmetic or
unused. This is not a measured decline of the item; it is the row recording that
the job was already owned, and that the comparison was made against the native
item because native is the repository's deliberate choice for it.

### Limits of this row

- The pointer path could not be exercised in either engine: a native `<select>`'s
  popup is the platform's own widget, absent from the DOM and from Playwright's
  reach. `selectOption` is a DOM-API path, not a pointer path, so it is not
  evidence for that checklist item. A person can run it on the harness page.
- Desktop Chromium only (Playwright, one worker). The mobile capture is a 390px
  viewport, not a device, and no iOS or Android picker was observed.
- The 5,000-row fixture is rendered in both columns in the browser run (5,000
  `<option>`s per select) but is not an axe target in either engine — the same
  recorded exclusion as row 1.
- The migration evidence (13 selects on 7 of the 14 screens walked, all the
  primitive, all named) was gathered by walking those screens, not by a
  committed test; the committed guard is the adoption test plus the kit's own
  suites.
- This row records one pair. It is not a verdict on the shadcn registry, on
  `@base-ui/react`'s `Select`, or on any other item.

## Adding a row

Register the pair in `src/components/component-compare/pairs/index.ts` with its
job and its control classes, run the two vitest suites and the browser spec, then
add the pair's row above and its detail section with: what we use now, what the
candidate offers, the per-item checklist result for both sides, the automated
evidence with its commands, the conditions an adoption would carry, the decision
and the reason, and the limits. `docs/development/component-compare.md` has the
step-by-step.
