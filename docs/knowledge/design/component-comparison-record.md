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

| #   | Component (generic UI job)                              | What we use now                                                                                                                                                                                                                 | What ReUI offers                                                                                                                                                                                                                           | Checklist result                                                                                                                                                                                                                                                                                                                                                                                                                         | Decision                                                                                                                                                                                                                                                                                               | Measured    |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------- |
| 1   | Reorderable list — reorder rows by pointer and keyboard | Notebook hand-rolled HTML5 drag-and-drop: `src/components/notebook/notebook-block-reorder.tsx`, consumed by `notebook-document.tsx` (mechanics were inline there before this row)                                               | `@reui/sortable` (base-nova pin), a `@dnd-kit` wrapper: `src/components/reui/sortable.tsx`                                                                                                                                                 | Ours: 9 of the 10 applicable items pass — pointer reordering is unavailable at 390x844, which is the reason for the decision (see the detail table). Theirs: all 10 pass **after one accessibility fix-up** (C1). 9 items are not applicable — this pair has no sort, filter, select, resize or pagination control, and no `navigate` control                                                                                            | **Adopt in a follow-up change**, conditional on C1–C4. Not adopted by this change, which adds no product surface                                                                                                                                                                                       | 16 Oct 2026 |
| 2   | Tab family — one of N views, in place                   | `src/components/v3/ui/tabs.tsx` in `mode="state"`: Base UI tablist — roving focus, ArrowLeft/ArrowRight, Home/End, `aria-selected`, activation on focus. The reconciliation that produced it deleted five other implementations | **Nothing to compare against:** the pinned registry answers 404 for `tabs` and says it is a shadcn item. Placed from shadcn/ui (new-york) at `src/components/reui/tabs.tsx`, primitive import re-pointed to the unified `radix-ui` package | Ours: 9 of the 9 applicable items pass. Theirs: the same 9 pass, with one structural difference and one cost — the tab stop sits on the `role="tablist"` container (`tabindex="0"`, inline `outline: none`) rather than on the tab, and the item as published needs `@radix-ui/react-tabs`. 10 items not applicable (no reorder, sort, filter, select, resize or pagination control)                                                     | **Decline — keep ours.** Both sides pass the same keyboard contract, so no named behaviour is missing; the item covers only the in-page half of the job (most of the strips this change migrated are URL tabs, which the item has no mode for) and would add a second primitive library beside Base UI | 16 Oct 2026 |
| 3   | Pressed-state chips — filter by several kinds at once   | The shipped multi-select chip row: `role="group"`, one `aria-pressed` button per kind, each chip its own tab stop (`revision-diff-review.tsx:493-534` is the reference shape)                                                   | **Nothing to compare against:** the pinned registry answers 404 for `toggle-group` and says it is a shadcn item. Placed from shadcn/ui (new-york) at `src/components/reui/toggle-group.tsx` + `toggle.tsx`                                 | Ours: 8 of the 8 applicable items pass. Theirs: the same 8 pass, but it announces `role="toolbar"` where ours announces `role="group"`, puts the single tab stop on that container (`tabindex="0"`, inline `outline: none`) and forwards focus to the first chip, and as published needs `@radix-ui/react-toggle-group`. 11 items not applicable, including `keyboard-navigate`: a multi-select group has no roving focus in its pattern | **Decline — keep ours.** No missing behaviour to buy, a role change we would have to reason about, and two more dependencies                                                                                                                                                                           | 16 Oct 2026 |

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

## Row 2 — Tab family (`tab-family`)

### What we use now

`src/components/v3/ui/tabs.tsx`, `mode="state"`: Base UI's tablist — one tab
stop, ArrowLeft/ArrowRight, Home/End, `aria-selected`, activation that follows
focus, and `aria-controls` only where a `TabsPanel` is rendered (a dangling
one is an axe violation). It is the outcome of this change's reconciliation: the
two `SearchTabs`, the unused `RouteTabs`, `LinkTabs` and `SegmentLinks` were
deleted, and nine hand-rolled strips and two chip rows moved onto this contract
in `mode="url"` where the tabs are URLs.

The job this pair compares is the in-page half: _switch which view of the same
rows is shown, without leaving the page_. The other half — tabs that are links,
with `aria-current="page"` — is most of the strips this change migrated, and the candidate
has no mode for it.

### What ReUI offers

**No ReUI item.** On 16 October 2026 the pinned registry redirects and answers:

```
$ curl -s https://reui.io/r/base-nova/tabs.json
{"error":"Registry item not found","message":"tabs is part of shadcn/ui, not a ReUI item. Install it with: npx shadcn@latest add tabs"}
```

so the candidate is the stock shadcn item (`ui.shadcn.com/r/styles/new-york/tabs.json`,
`registry:ui`, one file, dependency `@radix-ui/react-tabs`), placed at
`src/components/reui/tabs.tsx`. Three edits and nothing else, recorded in that
file's header: the primitive import re-pointed to the unified `radix-ui` package
the repository already has (as published it needs `@radix-ui/react-tabs`, which
is not a dependency), `cn` from `#/lib/utils`, and the tokens restyled
(`bg-muted` → `bg-surface-muted`, `ring-ring` → the kit's `outline-focus`), which
an adoption would have to do anyway.

### Checklist result

Applicable items are the 9 the pair has: `keyboard-tab` and
`keyboard-navigate` (`navigate` is the control class added for this pair — a
widget whose parts are moved between with the arrow keys), the five state items,
and both densities. The other 10 need reorder, sort, filter, select, resize or
pagination controls that neither side of this pair has.

| Check                                                                     | Ours                                                                                                                                                            | Theirs                                                                                                                                                    | How it was measured                                                  |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator                 | Pass — the tab stop is the current tab; the ring is drawn on it (`outline: solid 2px`)                                                                          | Pass — the tab stop is the `role="tablist"` container (`tabindex="0"`, inline `outline: none`); focusing it forwards focus to a tab, which draws the ring | Browser, both columns, `document.activeElement` + `getComputedStyle` |
| Move between the widget's parts with the arrow keys the pattern calls for | Pass — ArrowRight moved focus **and** selection from `All` to `Sample`, the roving `tabindex` followed (`[0,-1,-1,-1]` → `[-1,0,-1,-1]`), and the panel changed | Pass — the same, including wrap; `End` jumped to the last tab                                                                                             | Browser, trusted key events (`agent-browser press`), both columns    |
| Empty (0 rows), loading, error, permission-restricted                     | Pass (see the caveat below)                                                                                                                                     | Pass                                                                                                                                                      | jsdom and browser                                                    |
| Dark theme                                                                | Pass — token-bound colours only; axe clean in dark                                                                                                              | Pass                                                                                                                                                      | axe in Chromium, colour contrast on, both columns and both themes    |
| Density and overflow at 1440x900                                          | Pass — one line, no horizontal page overflow, long labels do not overlap                                                                                        | Pass                                                                                                                                                      | Browser, both columns                                                |
| Density and overflow at 390x844                                           | Pass — the rail scrolls sideways instead of wrapping, and the current tab is scrolled into view                                                                 | Pass                                                                                                                                                      | Browser, both columns, and the story's 390px state                   |

Sort, filter, select, resize and pagination: not applicable to this pair (10
items). They are listed in the harness with that verdict.

**Caveat on the empty, loading and error states.** As in row 1, these are picture
states of a whole screen and the harness owns them: both columns show the same
harness notice for a 0-row fixture, for loading and for a load failure. The
`restricted` state has nothing to disable in a view switch, so both columns show
the same notice above an unchanged strip; that is recorded rather than dressed up.

### Automated evidence

| Evidence                                                                                                                                                                   | Result                                                                            | Command                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| axe, both columns: 6 fixtures × 2 sides + 3 states × 2 sides (this pair)                                                                                                   | 18 cases, **zero violations** (colour contrast disabled: jsdom cannot measure it) | `pnpm exec vitest run src/components/component-compare/component-compare.a11y.test.tsx` |
| Harness contracts, including the registered pair set                                                                                                                       | pass                                                                              | `pnpm exec vitest run src/components/component-compare/component-compare.test.tsx`      |
| The contract itself: state mode's tab stop, arrows, Home/End, counts, callback; URL mode's `aria-current`, no `aria-selected`, and the `activeOptions` it hands the router | 5 tests, pass                                                                     | `pnpm exec vitest run src/components/v3/ui/tabs.test.tsx`                               |
| Appearance                                                                                                                                                                 | one capture per column per theme on the long-labels fixture                       | the harness at `/component-compare`, pair _Tab family_                                  |

### Decision and reason

**Decline — keep ours.** ADR-0055 decision 4 asks whether the candidate is
_materially better_: a named behaviour is missing from ours, or the maintenance
burden is demonstrably ours. Neither holds. Measured in the same browser, both
sides move focus with ArrowLeft/ArrowRight and Home/End, both announce
`role="tablist"`/`role="tab"` with `aria-selected`, and both keep one tab stop —
the only structural difference is _where_ that stop lives (the tab, or the
container). What the item does not have is the half of the job most of our
strips do: `mode="url"`, where each tab is its own URL and the current one
carries `aria-current="page"`. Adopting it would therefore either leave the app
with two tab implementations — the thing this change removed — or force the URL
mode onto a list component by hand.

The costs are real and one-sided: as published it needs `@radix-ui/react-tabs`,
a second primitive library beside the Base UI kit the v3 components are built on
(ADR-0055 decision 1), and its token vocabulary is the deprecated bridge
(`bg-muted`, `text-muted-foreground`, `outline: none`) that §11.5 says renders
wrong beside every neighbour while still passing the colour check.

This row is the _comparison_, not the reconciliation: the reconciliation is the
change that produced `src/components/v3/ui/tabs.tsx`, and it needed this
comparison done first, which is why the same change carries both.

### Limits of this row

- Desktop Chromium only (Playwright's engine through `agent-browser`); no
  Firefox, WebKit or real device was run.
- The two sides were compared on the _strip_: the panel under each is one line of
  text, so the items about content are answered by the columns' own containment.
- The candidate is the item **with the three edits its header records**. Left as
  published it would not compile here (`@radix-ui/react-tabs` is not installed),
  and that is itself part of the measured cost.
- The 5,000-row fixture is rendered and measured for overflow in both columns,
  not by axe (row 1's recorded limit applies to every pair).

## Row 3 — Pressed-state chips (`pressed-chips`)

### What we use now

The shipped multi-select filter chip row: `revision-diff-review.tsx:493-534` (its
change-type and change-area filters) — a `role="group"` with an `aria-label`, one
`<button aria-pressed>` per kind, a count in the label, and **each chip its own
tab stop**. Ten other sites share the shape.

This is the second half of the domain scan's "pressed-state toggle chip group"
finding. Its first half — the _single-select_ chip rows in `schedule.tsx`,
`review/$revisionId.tsx`, `audit/experiment-history.tsx` and
`scientific/scientific-record-linker.tsx` — turned out to be the tab job: they
are the `variant="segment"` state tabs now, with the roving focus and arrow keys
the scan said they lacked. The scan's claim does not hold for what is left: a
multi-select group has no roving focus in its pattern, which is why
`keyboard-navigate` is recorded as not applicable for this pair.

### What ReUI offers

**No ReUI item.** The pinned registry answers 404 the same way:

```
$ curl -s https://reui.io/r/base-nova/toggle-group.json
{"error":"Registry item not found","message":"toggle-group is part of shadcn/ui, not a ReUI item. Install it with: npx shadcn@latest add toggle-group"}
```

The candidate is the stock shadcn item (`toggle-group`, registry dependency
`toggle`, dependencies `@radix-ui/react-toggle-group` and `@radix-ui/react-toggle`),
placed at `src/components/reui/toggle-group.tsx` + `toggle.tsx` with the same
three edits as row 2.

### Checklist result

Applicable items are the 8 the pair has: `keyboard-tab`, the five state items and
both densities. The other 11 need controls this pair has none of — including
`keyboard-navigate`, which a multi-select group does not have a pattern for.

| Check                                                     | Ours                                                                                             | Theirs                                                                                                                                                 | How it was measured                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| Tab reaches every control, with a visible focus indicator | Pass — each chip is a tab stop of its own, and the chip draws the ring                           | Pass — the group is the single tab stop (`tabindex="0"`, inline `outline: none`); focusing it forwards focus to the first chip, which draws a 2px ring | Browser, both columns, `document.activeElement` + `getComputedStyle` |
| Empty (0 rows), loading, error, permission-restricted     | Pass — no chips to render for a fixture with no kinds; the columns' own states are the harness's | Pass                                                                                                                                                   | jsdom and browser                                                    |
| Dark theme                                                | Pass — token-bound colours only; axe clean in dark                                               | Pass                                                                                                                                                   | axe in Chromium, colour contrast on, both themes                     |
| Density and overflow at 1440x900                          | Pass — chips wrap inside the column, no page overflow                                            | Pass                                                                                                                                                   | Browser, both columns                                                |
| Density and overflow at 390x844                           | Pass — chips wrap, none clipped                                                                  | Pass                                                                                                                                                   | Browser, both columns                                                |

### Automated evidence

Same three commands as row 2, over this pair: **18 axe cases, zero
violations**, the harness contract tests, and `tabs.test.tsx` for the contract the
other half of the finding moved onto.

### Decision and reason

**Decline — keep ours.** There is no behaviour to buy. Both sides announce each
chip's pressed state as `aria-pressed`, and neither is unreachable by keyboard;
the differences the measurement found are costs, not gains: the item changes the
announced role from `group` to `toolbar` (a toolbar promises arrow-key
navigation between its controls, which a multi-select filter row does not
implement), moves the single tab stop onto that container (so Tab reaches the
row once rather than reaching the chips), and brings two dependencies
(`@radix-ui/react-toggle-group`, `@radix-ui/react-toggle`) or an import-path fix
that makes it not-as-published. Restyling it to Sheetbase tokens is ours either
way.

### Limits of this row

- Same engine, fixtures and exclusions as row 2.
- The candidate was compared `type="multiple"`, which is the mode the shipped
  sites use. A single-select row is a different job here and is the segment mode
  of the tab contract, not this item.
- The two chip rows in `revision-diff-review.tsx` are _filters_, and ADR-0055
  decision 6 holds anything the `sheetbase-advanced-search` filter builder owns
  until the filter model is reconciled. This row compares the control, not the
  filter model.

## Adding a row

Register the pair in `src/components/component-compare/pairs/index.ts` with its
job and its control classes, run the two vitest suites and the browser spec, then
add the pair's row above and its detail section with: what we use now, what the
candidate offers, the per-item checklist result for both sides, the automated
evidence with its commands, the conditions an adoption would carry, the decision
and the reason, and the limits. `docs/development/component-compare.md` has the
step-by-step, including where a declined candidate lives: vendored under
`src/components/reui/**` when the pair imports the real file, reproduced inside
the pair when it does not, with the row saying which.
